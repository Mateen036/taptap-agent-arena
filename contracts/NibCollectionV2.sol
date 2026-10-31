// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface INibIdentity { function balanceOf(address) external view returns (uint256); }
interface INibRenderer { function tokenURI(uint256) external view returns (string memory); }
interface INibPriceFeed { function decimals() external view returns (uint8); function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80); }
interface INibVaultV2Link { function usdt() external view returns (address); }
interface INibLegacyCollection { function ownerOf(uint256) external view returns (address); }

/// @notice NibCollectionV2: the same art, price and rules as the first Nib Collection, with every mint payment sent to NibVaultV2.
/// Economics: 10,000 ids in total; $0.05 per paid NFT (0.05 USDT, or the BNB equivalent from the Chainlink BNB/USD feed);
/// the first THREE public mints of each wallet are free; ten lifetime public mints per wallet (3 free + 7 paid).
/// Migration: ids 1..publicStartId-1 are reserved for an owner-only, one-time airdrop that mints the SAME ids to the CURRENT holders of the
/// first collection. The contract itself checks `legacy.ownerOf(id) == recipient`, so the owner cannot airdrop to anyone else. Airdropped NFTs do not
/// count toward the wallet limit or the free mint. After `finalizeAirdrop()` no airdrop can ever happen again, and only then can public minting open.
/// Before finalizing, the owner can also airdrop BONUS NFTs (`airdropBonus`, one new id per recipient entry, taken from the same counter as public mints, so
/// bonus ids follow the airdropped ids and public ids follow the bonus ids). Bonus NFTs do not count toward the wallet limit or the free mints either.
/// Public mints continue from the first id after the airdrop and bonus ids and can never collide with an airdropped id.
/// @dev Registry ownership is an eligibility gate for trading and public minting. The airdrop alone skips the recipient gate (it only mints ids that a
/// holder already owns in the first collection), so one holder without an Agent ID cannot block a batch.
contract NibCollectionV2 is ERC721Enumerable, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant WALLET_LIMIT = 10;
    uint256 public constant FREE_PER_WALLET = 3;
    uint256 public constant MAX_AIRDROP_BATCH = 100;
    uint256 public constant PRICE_MAX_AGE = 1 hours;
    INibIdentity public immutable agentIdRegistry;
    IERC20 public immutable paymentToken;
    INibRenderer public immutable renderer;
    /// @dev Every mint payment (USDT and BNB) goes here. Kept under the old name `lpVault` so existing tooling reads it unchanged.
    address public immutable lpVault;
    uint256 public immutable mintPrice;
    INibPriceFeed public immutable priceFeed;
    INibLegacyCollection public immutable legacy;
    uint256 public immutable publicStartId;
    uint256 public nextPublicId;
    uint256 public publicMinted;
    uint256 public airdropCount;
    uint256 public bonusCount;
    /// @notice Total NFTs the owner has minted for free through `ownerMint` (giveaways, partnerships). Public for transparency.
    uint256 public ownerMinted;
    uint256 public paidMintCount;
    bool public mintOpen;
    bool public airdropFinalized;
    bool private _airdropMint;
    mapping(address => uint256) public mintedBy;
    mapping(uint256 => bool) public airdropped;
    mapping(address => mapping(bytes32 => bool)) public usedIntents;
    event Minted(address indexed wallet, uint256 indexed firstTokenId, uint256 quantity, uint256 payment);
    event NativeMintPaid(address indexed wallet, uint256 payment, uint256 refund);
    event MintAvailability(bool open);
    event Airdropped(address indexed to, uint256 indexed tokenId);
    event BonusAirdropped(address indexed to, uint256 indexed tokenId);
    event OwnerMinted(address indexed to, uint256 firstTokenId, uint256 quantity);
    event OwnerMintBatch(uint256 count, uint256 totalOwnerMinted);
    event BonusBatch(uint256 count, uint256 totalBonus);
    event AirdropBatch(uint256 count, uint256 totalAirdropped);
    event AirdropFinalized(uint256 totalAirdropped);

    constructor(address registry_, address payment_, address vault_, address renderer_, address owner_, address feed_, address legacy_, uint256 publicStartId_)
        ERC721("Nib Collection", "NIB") Ownable(owner_)
    {
        require(registry_.code.length > 0 && payment_.code.length > 0, "Missing registry/payment");
        require(vault_.code.length > 0 && renderer_.code.length > 0, "Missing vault/renderer");
        require(INibVaultV2Link(vault_).usdt() == payment_, "Vault payment mismatch");
        require(legacy_.code.length > 0 && legacy_ != address(this), "Missing legacy collection");
        require(publicStartId_ >= 2 && publicStartId_ <= MAX_SUPPLY, "Invalid public start id");
        uint8 decimals = IERC20Metadata(payment_).decimals();
        require(decimals > 0 && decimals <= 18, "Unsupported decimals");
        require(feed_.code.length > 0 && INibPriceFeed(feed_).decimals() == 8, "Invalid BNB/USD feed");
        priceFeed = INibPriceFeed(feed_);
        agentIdRegistry = INibIdentity(registry_);
        paymentToken = IERC20(payment_);
        renderer = INibRenderer(renderer_);
        lpVault = vault_;
        legacy = INibLegacyCollection(legacy_);
        publicStartId = publicStartId_;
        nextPublicId = publicStartId_;
        require(decimals >= 2, "Unsupported decimals");
        mintPrice = 10 ** decimals / 20; // $0.05
    }

    /// @notice Total NFTs that exist: airdropped v1 ids, bonus NFTs and publicly minted.
    function minted() public view returns (uint256) { return airdropCount + bonusCount + ownerMinted + publicMinted; }
    /// @dev Of `quantity` new public mints, how many are free: the wallet's first FREE_PER_WALLET public mints.
    function _paidOf(address wallet, uint256 quantity) internal view returns (uint256) {
        uint256 used = mintedBy[wallet];
        uint256 freeLeft = used >= FREE_PER_WALLET ? 0 : FREE_PER_WALLET - used;
        return quantity - (quantity < freeLeft ? quantity : freeLeft);
    }
    function publicRemaining() public view returns (uint256) { return MAX_SUPPLY + 1 - nextPublicId; }

    function mintCost(address wallet, uint256 quantity) public view returns (uint256) {
        require(quantity > 0 && quantity <= WALLET_LIMIT, "Quantity 1-10");
        return _paidOf(wallet, quantity) * mintPrice;
    }
    function mintPriceBNB() public view returns (uint256) {
        (uint80 round, int256 answer,,uint256 updatedAt,uint80 answeredInRound) = priceFeed.latestRoundData();
        require(round > 0 && answer > 0 && answeredInRound >= round, "Invalid BNB/USD round");
        require(updatedAt > 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= PRICE_MAX_AGE, "Stale BNB/USD price");
        return (5e24 + uint256(answer) - 1) / uint256(answer); // $0.05 (feed has 8 decimals: 0.05e18 * 1e8), rounded up to a wei.
    }
    function mintCostBNB(address wallet, uint256 quantity) public view returns (uint256) {
        require(quantity > 0 && quantity <= WALLET_LIMIT, "Quantity 1-10");
        uint256 paid = _paidOf(wallet, quantity);
        return paid == 0 ? 0 : paid * mintPriceBNB();
    }
    function _reserve(uint256 quantity, uint256 deadline, bytes32 intentId) internal returns (uint256 firstId, uint256 paid) {
        require(mintOpen && block.timestamp <= deadline, "Mint closed/expired");
        require(intentId != bytes32(0) && !usedIntents[msg.sender][intentId], "Intent already used");
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Agent ID required");
        require(quantity > 0 && mintedBy[msg.sender] + quantity <= WALLET_LIMIT, "Wallet mint limit");
        require(nextPublicId + quantity <= MAX_SUPPLY + 1, "Sold out");
        paid = _paidOf(msg.sender, quantity);
        firstId = nextPublicId;
        usedIntents[msg.sender][intentId] = true;
        mintedBy[msg.sender] += quantity;
        nextPublicId += quantity;
        publicMinted += quantity;
        paidMintCount += paid;
    }
    function _deliver(uint256 firstId, uint256 quantity) internal {
        for (uint256 i; i < quantity; ++i) _safeMint(msg.sender, firstId + i);
    }
    function mint(uint256 quantity, uint256 maxPayment, uint256 deadline, bytes32 intentId) external nonReentrant whenNotPaused {
        (uint256 firstId, uint256 paid) = _reserve(quantity, deadline, intentId);
        uint256 cost = paid * mintPrice;
        require(cost <= maxPayment, "Quote changed");
        if (cost > 0) {
            uint256 beforeBalance = paymentToken.balanceOf(lpVault);
            paymentToken.safeTransferFrom(msg.sender, lpVault, cost);
            require(paymentToken.balanceOf(lpVault) - beforeBalance == cost, "Payment token fee");
        }
        _deliver(firstId, quantity);
        emit Minted(msg.sender, firstId, quantity, cost);
    }
    function mintBNB(uint256 quantity, uint256 maxPayment, uint256 deadline, bytes32 intentId) external payable nonReentrant whenNotPaused {
        (uint256 firstId, uint256 paid) = _reserve(quantity, deadline, intentId);
        uint256 cost = paid == 0 ? 0 : paid * mintPriceBNB();
        require(msg.value == maxPayment && cost <= maxPayment, "BNB quote changed/value mismatch");
        if (cost > 0) { (bool funded,) = payable(lpVault).call{value:cost}(""); require(funded, "Vault payment failed"); }
        _deliver(firstId, quantity);
        uint256 refund = msg.value - cost;
        if (refund > 0) { (bool refunded,) = payable(msg.sender).call{value:refund}(""); require(refunded, "BNB refund failed"); }
        emit Minted(msg.sender, firstId, quantity, 0);
        emit NativeMintPaid(msg.sender, cost, refund);
    }

    /// @notice Owner-only, batched, before finalizeAirdrop(): mint the same id to its CURRENT holder in the first collection. Once per id.
    /// Does not count toward `mintedBy` (the wallet limit and the free mint are untouched) and does not need the recipient to hold an Agent ID.
    function airdrop(address[] calldata to, uint256[] calldata ids) external onlyOwner nonReentrant {
        require(!airdropFinalized, "Airdrop finalized");
        require(to.length == ids.length && ids.length > 0 && ids.length <= MAX_AIRDROP_BATCH, "Invalid batch");
        _airdropMint = true;
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            address recipient = to[i];
            require(id >= 1 && id < publicStartId, "Id outside airdrop range");
            require(!airdropped[id], "Id already airdropped");
            require(recipient != address(0) && legacy.ownerOf(id) == recipient, "Not the current holder");
            airdropped[id] = true;
            _mint(recipient, id);
            emit Airdropped(recipient, id);
        }
        _airdropMint = false;
        airdropCount += ids.length;
        emit AirdropBatch(ids.length, airdropCount);
    }
    /// @notice Owner-only, batched, before finalizeAirdrop(): mint BONUS NFTs, one NEW id per entry of `to` (repeat an address for several). The ids come from the
    /// public counter, so they follow the airdropped ids and the public mint continues after them. Bonus NFTs do not count toward `mintedBy` and the recipient
    /// needs no Agent ID to receive them. The owner chooses the recipients and amounts, so the snapshot script derives them from v1 payments.
    function airdropBonus(address[] calldata to) external onlyOwner nonReentrant {
        require(!airdropFinalized, "Airdrop finalized");
        require(to.length > 0 && to.length <= MAX_AIRDROP_BATCH, "Invalid batch");
        require(nextPublicId + to.length <= MAX_SUPPLY + 1, "Sold out");
        _airdropMint = true;
        uint256 id = nextPublicId;
        for (uint256 i; i < to.length; ++i) {
            require(to[i] != address(0), "Zero recipient");
            _mint(to[i], id);
            emit BonusAirdropped(to[i], id);
            ++id;
        }
        _airdropMint = false;
        nextPublicId = id;
        bonusCount += to.length;
        emit BonusBatch(to.length, bonusCount);
    }
    /// @notice Owner-only free mint for future airdrops and giveaways. Usable at any time (also after finalizeAirdrop and while public minting is open), counts toward the
    /// 10,000 maximum supply, ignores wallet limits and the free-mint allowance, and needs no Agent ID on the recipient. Every call is public (events + `ownerMinted`).
    /// @param to recipients; @param counts how many NFTs each recipient receives. At most MAX_AIRDROP_BATCH NFTs per call.
    function ownerMint(address[] calldata to, uint256[] calldata counts) external onlyOwner nonReentrant {
        require(to.length == counts.length && to.length > 0, "Invalid batch");
        uint256 total;
        for (uint256 i; i < counts.length; ++i) { require(counts[i] > 0, "Zero quantity"); total += counts[i]; }
        require(total <= MAX_AIRDROP_BATCH, "Invalid batch");
        require(nextPublicId + total <= MAX_SUPPLY + 1, "Sold out");
        _airdropMint = true;
        uint256 id = nextPublicId;
        for (uint256 i; i < to.length; ++i) {
            require(to[i] != address(0), "Zero recipient");
            uint256 first = id;
            for (uint256 j; j < counts[i]; ++j) { _mint(to[i], id); ++id; }
            emit OwnerMinted(to[i], first, counts[i]);
        }
        _airdropMint = false;
        nextPublicId = id;
        ownerMinted += total;
        emit OwnerMintBatch(total, ownerMinted);
    }
    /// @notice Permanently closes the v1 airdrop and the bonus airdrop. Irreversible. (`ownerMint` stays available.)
    function finalizeAirdrop() external onlyOwner {
        require(!airdropFinalized, "Airdrop finalized");
        airdropFinalized = true;
        emit AirdropFinalized(airdropCount);
    }

    /// @notice Public minting starts closed and can only be opened after the airdrop is finalized.
    function setMintOpen(bool open) external onlyOwner {
        require(!open || airdropFinalized, "Finalize the airdrop first");
        mintOpen = open;
        emit MintAvailability(open);
    }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function renounceOwnership() public view override onlyOwner { revert("Renounce disabled"); }
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return renderer.tokenURI(tokenId);
    }
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (to != address(0) && !_airdropMint) require(agentIdRegistry.balanceOf(to) > 0, "Recipient needs Agent ID");
        if (from != address(0)) require(agentIdRegistry.balanceOf(from) > 0, "Sender needs Agent ID");
        return super._update(to, tokenId, auth);
    }
}
