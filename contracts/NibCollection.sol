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
interface INibVault { function paymentToken() external view returns (IERC20); }

/// @notice Immutable economics: 10,000 NFTs; first mint per wallet free; ten lifetime mints.
/// @dev Registry ownership is an eligibility gate. It cannot prove that an AI authored a transaction.
contract NibCollection is ERC721Enumerable, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant WALLET_LIMIT = 10;
    INibIdentity public immutable agentIdRegistry;
    IERC20 public immutable paymentToken;
    INibRenderer public immutable renderer;
    address public immutable lpVault;
    uint256 public immutable mintPrice;
    INibPriceFeed public immutable priceFeed;
    uint256 public constant PRICE_MAX_AGE = 1 hours;
    uint256 public minted;
    uint256 public paidMintCount;
    bool public mintOpen = true;
    mapping(address => uint256) public mintedBy;
    mapping(address => mapping(bytes32 => bool)) public usedIntents;
    event Minted(address indexed wallet, uint256 indexed firstTokenId, uint256 quantity, uint256 payment);
    event NativeMintPaid(address indexed wallet, uint256 payment, uint256 refund);
    event MintAvailability(bool open);

    constructor(address registry_, address payment_, address vault_, address renderer_, address owner_, address feed_)
        ERC721("Nib Collection", "NIB") Ownable(owner_)
    {
        require(registry_.code.length > 0 && payment_.code.length > 0, "Missing registry/payment");
        require(vault_.code.length > 0 && renderer_.code.length > 0, "Missing vault/renderer");
        require(address(INibVault(vault_).paymentToken()) == payment_, "Vault payment mismatch");
        uint8 decimals = IERC20Metadata(payment_).decimals();
        require(decimals > 0 && decimals <= 18, "Unsupported decimals");
        require(feed_.code.length > 0 && INibPriceFeed(feed_).decimals() == 8, "Invalid BNB/USD feed");
        priceFeed = INibPriceFeed(feed_);
        agentIdRegistry = INibIdentity(registry_);
        paymentToken = IERC20(payment_);
        renderer = INibRenderer(renderer_);
        lpVault = vault_;
        mintPrice = 10 ** decimals;
    }

    function mintCost(address wallet, uint256 quantity) public view returns (uint256) {
        require(quantity > 0 && quantity <= WALLET_LIMIT, "Quantity 1-10");
        return (quantity - (mintedBy[wallet] == 0 ? 1 : 0)) * mintPrice;
    }

    function mintPriceBNB() public view returns (uint256) {
        (uint80 round, int256 answer,,uint256 updatedAt,uint80 answeredInRound) = priceFeed.latestRoundData();
        require(round > 0 && answer > 0 && answeredInRound >= round, "Invalid BNB/USD round");
        require(updatedAt > 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= PRICE_MAX_AGE, "Stale BNB/USD price");
        return (1e26 + uint256(answer) - 1) / uint256(answer); // $1, rounded up to a wei.
    }
    function mintCostBNB(address wallet, uint256 quantity) public view returns (uint256) {
        require(quantity > 0 && quantity <= WALLET_LIMIT, "Quantity 1-10");
        uint256 paid = quantity - (mintedBy[wallet] == 0 ? 1 : 0);
        return paid == 0 ? 0 : paid * mintPriceBNB();
    }
    function _reserve(uint256 quantity, uint256 deadline, bytes32 intentId) internal returns (uint256 firstId, uint256 paid) {
        require(mintOpen && block.timestamp <= deadline, "Mint closed/expired");
        require(intentId != bytes32(0) && !usedIntents[msg.sender][intentId], "Intent already used");
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Agent ID required");
        require(quantity > 0 && mintedBy[msg.sender] + quantity <= WALLET_LIMIT, "Wallet mint limit");
        require(minted + quantity <= MAX_SUPPLY, "Sold out");
        paid = quantity - (mintedBy[msg.sender] == 0 ? 1 : 0);
        firstId = minted + 1;
        usedIntents[msg.sender][intentId] = true;
        mintedBy[msg.sender] += quantity;
        minted += quantity;
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
        if (cost > 0) { (bool funded,) = payable(lpVault).call{value:cost}(""); require(funded, "LP vault payment failed"); }
        _deliver(firstId, quantity);
        uint256 refund = msg.value - cost;
        if (refund > 0) { (bool refunded,) = payable(msg.sender).call{value:refund}(""); require(refunded, "BNB refund failed"); }
        emit Minted(msg.sender, firstId, quantity, 0);
        emit NativeMintPaid(msg.sender, cost, refund);
    }

    function setMintOpen(bool open) external onlyOwner { mintOpen = open; emit MintAvailability(open); }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return renderer.tokenURI(tokenId);
    }
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (to != address(0)) require(agentIdRegistry.balanceOf(to) > 0, "Recipient needs Agent ID");
        if (from != address(0)) require(agentIdRegistry.balanceOf(from) > 0, "Sender needs Agent ID");
        return super._update(to, tokenId, auth);
    }
}
