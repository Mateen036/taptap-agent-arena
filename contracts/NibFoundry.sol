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
interface INibVault { function paymentToken() external view returns (IERC20); }

/// @notice Immutable economics: 10,000 NFTs; first mint per wallet free; ten lifetime mints.
/// @dev Registry ownership is an eligibility gate. It cannot prove that an AI authored a transaction.
contract NibFoundry is ERC721Enumerable, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant WALLET_LIMIT = 10;
    INibIdentity public immutable agentIdRegistry;
    IERC20 public immutable paymentToken;
    INibRenderer public immutable renderer;
    address public immutable lpVault;
    uint256 public immutable mintPrice;
    uint256 public minted;
    uint256 public paidMintCount;
    bool public mintOpen = true;
    mapping(address => uint256) public mintedBy;
    mapping(address => mapping(bytes32 => bool)) public usedIntents;
    event Minted(address indexed wallet, uint256 indexed firstTokenId, uint256 quantity, uint256 payment);
    event MintAvailability(bool open);

    constructor(address registry_, address payment_, address vault_, address renderer_, address owner_)
        ERC721("Nib Foundry", "NIB") Ownable(owner_)
    {
        require(registry_.code.length > 0 && payment_.code.length > 0, "Missing registry/payment");
        require(vault_.code.length > 0 && renderer_.code.length > 0, "Missing vault/renderer");
        require(address(INibVault(vault_).paymentToken()) == payment_, "Vault payment mismatch");
        uint8 decimals = IERC20Metadata(payment_).decimals();
        require(decimals > 0 && decimals <= 18, "Unsupported decimals");
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

    function mint(uint256 quantity, uint256 maxPayment, uint256 deadline, bytes32 intentId) external nonReentrant whenNotPaused {
        require(mintOpen && block.timestamp <= deadline, "Mint closed/expired");
        require(intentId != bytes32(0) && !usedIntents[msg.sender][intentId], "Intent already used");
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Agent ID required");
        require(quantity > 0 && mintedBy[msg.sender] + quantity <= WALLET_LIMIT, "Wallet mint limit");
        require(minted + quantity <= MAX_SUPPLY, "Sold out");
        uint256 cost = mintCost(msg.sender, quantity);
        require(cost <= maxPayment, "Quote changed");
        uint256 firstId = minted + 1;
        usedIntents[msg.sender][intentId] = true;
        mintedBy[msg.sender] += quantity;
        minted += quantity;
        if (cost > 0) {
            uint256 beforeBalance = paymentToken.balanceOf(lpVault);
            paymentToken.safeTransferFrom(msg.sender, lpVault, cost);
            require(paymentToken.balanceOf(lpVault) - beforeBalance == cost, "Payment token fee");
            paidMintCount += cost / mintPrice;
        }
        for (uint256 i; i < quantity; ++i) _safeMint(msg.sender, firstId + i);
        emit Minted(msg.sender, firstId, quantity, cost);
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
