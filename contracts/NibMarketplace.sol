// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface INibMarketIdentity { function balanceOf(address) external view returns (uint256); }

/// @notice Noncustodial, zero-fee, fixed-price market. Each purchase checks its exact listing version.
contract NibMarketplace is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;
    struct Listing { uint256 id; address seller; uint256 price; uint256 expiresAt; }
    IERC721 public immutable collection;
    IERC20 public immutable paymentToken;
    INibMarketIdentity public immutable agentIdRegistry;
    uint256 public listingNonce;
    uint256 public completedSales;
    uint256 public volume;
    mapping(uint256 => Listing) public listings;
    EnumerableSet.UintSet private active;
    event Listed(uint256 indexed tokenId, uint256 indexed id, address indexed seller, uint256 price, uint256 expiresAt);
    event Cancelled(uint256 indexed tokenId, uint256 indexed id);
    event Bought(uint256 indexed tokenId, uint256 indexed id, address indexed buyer, address seller, uint256 price);

    constructor(address collection_, address payment_, address registry_) {
        require(collection_.code.length > 0 && payment_.code.length > 0 && registry_.code.length > 0, "Missing contracts");
        collection = IERC721(collection_);
        paymentToken = IERC20(payment_);
        agentIdRegistry = INibMarketIdentity(registry_);
    }
    function available(uint256 tokenId) public view returns (bool) {
        Listing memory l = listings[tokenId];
        if (l.id == 0 || l.expiresAt <= block.timestamp || agentIdRegistry.balanceOf(l.seller) == 0) return false;
        try collection.ownerOf(tokenId) returns (address owner) {
            return owner == l.seller && (collection.getApproved(tokenId) == address(this) || collection.isApprovedForAll(owner,address(this)));
        } catch { return false; }
    }
    function activeCount() external view returns (uint256) { return active.length(); }
    function activeAt(uint256 index) external view returns (uint256) { return active.at(index); }
    function list(uint256 tokenId, uint256 price, uint256 expiresAt) external nonReentrant {
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Agent ID required");
        require(collection.ownerOf(tokenId) == msg.sender, "Only NFT owner");
        require(collection.getApproved(tokenId) == address(this) || collection.isApprovedForAll(msg.sender,address(this)), "Approve this NFT");
        require(price > 0 && price <= 1_000_000 ether, "Invalid price");
        require(expiresAt > block.timestamp && expiresAt <= block.timestamp + 30 days, "Expiry 1-30 days");
        uint256 id = ++listingNonce;
        listings[tokenId] = Listing(id,msg.sender,price,expiresAt);
        active.add(tokenId);
        emit Listed(tokenId,id,msg.sender,price,expiresAt);
    }
    function cancel(uint256 tokenId, uint256 expectedId) external nonReentrant {
        Listing memory l = listings[tokenId];
        require(l.seller == msg.sender && l.id == expectedId, "Listing changed/not yours");
        delete listings[tokenId]; active.remove(tokenId);
        emit Cancelled(tokenId,l.id);
    }
    function prune(uint256 tokenId) external {
        require(!available(tokenId), "Listing still available");
        uint256 id = listings[tokenId].id;
        delete listings[tokenId]; active.remove(tokenId);
        if (id > 0) emit Cancelled(tokenId,id);
    }
    function buy(uint256 tokenId, uint256 expectedId, uint256 expectedPrice, address expectedSeller, uint256 deadline) external nonReentrant {
        require(block.timestamp <= deadline, "Purchase expired");
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Buyer needs Agent ID");
        Listing memory l = listings[tokenId];
        require(l.id == expectedId && l.price == expectedPrice && l.seller == expectedSeller, "Listing changed");
        require(l.seller != msg.sender && available(tokenId), "Listing unavailable");
        delete listings[tokenId]; active.remove(tokenId);
        uint256 beforeBalance = paymentToken.balanceOf(l.seller);
        paymentToken.safeTransferFrom(msg.sender,l.seller,l.price);
        require(paymentToken.balanceOf(l.seller) - beforeBalance == l.price, "Payment token fee");
        collection.safeTransferFrom(l.seller,msg.sender,tokenId);
        ++completedSales; volume += l.price;
        emit Bought(tokenId,l.id,msg.sender,l.seller,l.price);
    }
}
