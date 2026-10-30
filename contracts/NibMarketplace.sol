// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface INibMarketIdentity { function balanceOf(address) external view returns (uint256); }

/// @notice Native BNB listings and escrowed, owner-bound bids. Immutable 2% buyer and seller fees.
contract NibMarketplace is ReentrancyGuard {
    using EnumerableSet for EnumerableSet.UintSet;
    struct Listing { uint256 id; address seller; uint256 price; uint256 expiresAt; }
    struct Bid { uint256 tokenId; address bidder; address seller; uint256 price; uint256 expiresAt; }
    uint256 public constant BUYER_FEE_BPS = 200;
    uint256 public constant SELLER_FEE_BPS = 200;
    IERC721 public immutable collection;
    address public constant paymentToken = address(0);
    INibMarketIdentity public immutable agentIdRegistry;
    address payable public immutable feeRecipient;
    uint256 public listingNonce;
    uint256 public bidNonce;
    uint256 public completedSales;
    uint256 public volume;
    uint256 public feesCollected;
    uint256 public escrowedBNB;
    uint256 public totalRefunds;
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Bid) public bids;
    mapping(address => mapping(uint256 => uint256)) public bidderTokenBid;
    mapping(address => uint256) public refunds;
    EnumerableSet.UintSet private active;
    EnumerableSet.UintSet private activeBids;
    mapping(address => EnumerableSet.UintSet) private bidderBids;
    mapping(address => EnumerableSet.UintSet) private sellerBids;
    event Listed(uint256 indexed tokenId, uint256 indexed id, address indexed seller, uint256 price, uint256 expiresAt);
    event Cancelled(uint256 indexed tokenId, uint256 indexed id);
    event Bought(uint256 indexed tokenId, uint256 indexed id, address indexed buyer, address seller, uint256 price);
    event FeesPaid(uint256 indexed tokenId, address indexed recipient, uint256 buyerFee, uint256 sellerFee);
    event BidPlaced(uint256 indexed id, uint256 indexed tokenId, address indexed bidder, address seller, uint256 price, uint256 deposit, uint256 expiresAt);
    event BidCancelled(uint256 indexed id, address indexed bidder, uint256 refund);
    event BidAccepted(uint256 indexed id, uint256 indexed tokenId, address indexed bidder, address seller, uint256 price);
    event RefundWithdrawn(address indexed bidder, address indexed recipient, uint256 amount);

    constructor(address collection_, address registry_, address payable feeRecipient_) {
        require(collection_.code.length > 0 && registry_.code.length > 0, "Missing contracts");
        require(feeRecipient_ != address(0) && feeRecipient_ != address(this) && feeRecipient_ != collection_, "Invalid fee recipient");
        collection = IERC721(collection_);
        agentIdRegistry = INibMarketIdentity(registry_);
        feeRecipient = feeRecipient_;
    }
    /// @dev Fees round down to whole wei independently; gas is not included.
    function quote(uint256 price) public pure returns (uint256 buyerFee, uint256 sellerFee, uint256 buyerTotal, uint256 sellerProceeds) {
        buyerFee = price * BUYER_FEE_BPS / 10_000;
        sellerFee = price * SELLER_FEE_BPS / 10_000;
        buyerTotal = price + buyerFee;
        sellerProceeds = price - sellerFee;
    }
    function approved(uint256 tokenId, address owner) private view returns (bool) {
        return collection.getApproved(tokenId) == address(this) || collection.isApprovedForAll(owner,address(this));
    }
    function available(uint256 tokenId) public view returns (bool) {
        Listing memory l = listings[tokenId];
        if (l.id == 0 || l.expiresAt <= block.timestamp || agentIdRegistry.balanceOf(l.seller) == 0) return false;
        try collection.ownerOf(tokenId) returns (address owner) { return owner == l.seller && approved(tokenId,owner); } catch { return false; }
    }
    function activeCount() external view returns (uint256) { return active.length(); }
    function activeAt(uint256 index) external view returns (uint256) { return active.at(index); }
    function bidCount() external view returns (uint256) { return activeBids.length(); }
    function bidAt(uint256 index) external view returns (uint256) { return activeBids.at(index); }
    function bidderBidCount(address bidder) external view returns (uint256) { return bidderBids[bidder].length(); }
    function bidderBidAt(address bidder, uint256 index) external view returns (uint256) { return bidderBids[bidder].at(index); }
    function sellerBidCount(address seller) external view returns (uint256) { return sellerBids[seller].length(); }
    function sellerBidAt(address seller, uint256 index) external view returns (uint256) { return sellerBids[seller].at(index); }
    /// @dev Approval is requested separately by the seller before accepting. A listing is not required.
    function bidAvailable(uint256 id) public view returns (bool) {
        Bid memory b = bids[id];
        if (b.bidder == address(0) || b.expiresAt <= block.timestamp || agentIdRegistry.balanceOf(b.bidder) == 0 || agentIdRegistry.balanceOf(b.seller) == 0) return false;
        try collection.ownerOf(b.tokenId) returns (address owner) { return owner == b.seller; } catch { return false; }
    }
    function validTerms(uint256 price, uint256 expiresAt) private view {
        require(price > 0 && price <= 1_000_000 ether, "Invalid price");
        require(expiresAt > block.timestamp && expiresAt <= block.timestamp + 30 days, "Expiry within 30 days");
    }
    function list(uint256 tokenId, uint256 price, uint256 expiresAt) external nonReentrant {
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Agent ID required");
        require(collection.ownerOf(tokenId) == msg.sender, "Only NFT owner");
        require(approved(tokenId,msg.sender), "Approve this NFT");
        validTerms(price,expiresAt);
        uint256 id = ++listingNonce;
        listings[tokenId] = Listing(id,msg.sender,price,expiresAt);
        active.add(tokenId);
        emit Listed(tokenId,id,msg.sender,price,expiresAt);
    }
    function cancel(uint256 tokenId, uint256 expectedId) external nonReentrant {
        Listing memory l = listings[tokenId];
        require(l.seller == msg.sender && l.id == expectedId, "Listing changed/not yours");
        clearListing(tokenId);
    }
    function clearListing(uint256 tokenId) private {
        uint256 id = listings[tokenId].id;
        delete listings[tokenId]; active.remove(tokenId);
        if (id > 0) emit Cancelled(tokenId,id);
    }
    function prune(uint256 tokenId) external nonReentrant {
        require(!available(tokenId), "Listing still available");
        clearListing(tokenId);
    }
    function buy(uint256 tokenId, uint256 expectedId, uint256 expectedPrice, address expectedSeller, uint256 deadline) external payable nonReentrant {
        require(block.timestamp <= deadline, "Purchase expired");
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Buyer needs Agent ID");
        Listing memory l = listings[tokenId];
        require(l.id == expectedId && l.price == expectedPrice && l.seller == expectedSeller, "Listing changed");
        require(l.seller != msg.sender && available(tokenId), "Listing unavailable");
        (,,uint256 total,) = quote(l.price);
        require(msg.value == total, "Exact BNB total required");
        clearListing(tokenId);
        settle(tokenId,msg.sender,l.seller,l.price);
        emit Bought(tokenId,l.id,msg.sender,l.seller,l.price);
    }
    function placeBid(uint256 tokenId, uint256 price, uint256 expiresAt, address expectedSeller) external payable nonReentrant {
        require(agentIdRegistry.balanceOf(msg.sender) > 0 && agentIdRegistry.balanceOf(expectedSeller) > 0, "Agent ID required");
        require(expectedSeller != msg.sender && collection.ownerOf(tokenId) == expectedSeller, "NFT owner changed/self bid");
        require(bidderTokenBid[msg.sender][tokenId] == 0, "Cancel existing bid first");
        validTerms(price,expiresAt);
        (,,uint256 deposit,) = quote(price);
        require(msg.value == deposit, "Exact bid deposit required");
        uint256 id = ++bidNonce;
        bids[id] = Bid(tokenId,msg.sender,expectedSeller,price,expiresAt);
        bidderTokenBid[msg.sender][tokenId] = id;
        activeBids.add(id); bidderBids[msg.sender].add(id); sellerBids[expectedSeller].add(id);
        escrowedBNB += deposit;
        emit BidPlaced(id,tokenId,msg.sender,expectedSeller,price,deposit,expiresAt);
    }
    function removeBid(uint256 id, Bid memory b) private returns (uint256 deposit) {
        (,,deposit,) = quote(b.price);
        delete bids[id]; delete bidderTokenBid[b.bidder][b.tokenId];
        activeBids.remove(id); bidderBids[b.bidder].remove(id); sellerBids[b.seller].remove(id);
        escrowedBNB -= deposit;
    }
    function refundBid(uint256 id, Bid memory b) private {
        uint256 deposit = removeBid(id,b);
        refunds[b.bidder] += deposit; totalRefunds += deposit;
        emit BidCancelled(id,b.bidder,deposit);
    }
    /// @notice Cancellation and withdrawal remain available without an Agent ID. Never charge trading fees on a cancelled bid.
    function cancelBid(uint256 id) external nonReentrant {
        Bid memory b = bids[id];
        require(b.bidder == msg.sender, "Bid not yours/missing");
        refundBid(id,b);
    }
    function pruneBid(uint256 id) external nonReentrant {
        Bid memory b = bids[id];
        require(b.bidder != address(0) && !bidAvailable(id), "Bid still available/missing");
        refundBid(id,b);
    }
    function withdrawRefund(uint256 amount, address payable recipient) external nonReentrant {
        require(amount > 0 && amount <= refunds[msg.sender], "Invalid refund amount");
        require(recipient != address(0) && recipient != address(this), "Invalid refund recipient");
        refunds[msg.sender] -= amount; totalRefunds -= amount;
        (bool paid,) = recipient.call{value:amount}("");
        require(paid, "BNB refund failed");
        emit RefundWithdrawn(msg.sender,recipient,amount);
    }
    function acceptBid(uint256 id, address expectedBidder, uint256 expectedPrice, uint256 deadline) external nonReentrant {
        require(block.timestamp <= deadline, "Acceptance expired");
        Bid memory b = bids[id];
        require(b.bidder == expectedBidder && b.price == expectedPrice && b.seller == msg.sender && bidAvailable(id), "Bid changed/unavailable");
        require(approved(b.tokenId,msg.sender), "Approve this NFT");
        removeBid(id,b); clearListing(b.tokenId);
        settle(b.tokenId,b.bidder,b.seller,b.price);
        emit BidAccepted(id,b.tokenId,b.bidder,b.seller,b.price);
    }
    function settle(uint256 tokenId, address buyer, address seller, uint256 price) private {
        (uint256 buyerFee,uint256 sellerFee,,uint256 proceeds) = quote(price);
        collection.safeTransferFrom(seller,buyer,tokenId);
        (bool paid,) = payable(seller).call{value:proceeds}("");
        require(paid, "BNB seller payment failed");
        uint256 fee = buyerFee + sellerFee;
        if (fee > 0) { (bool feePaid,) = feeRecipient.call{value:fee}(""); require(feePaid, "BNB fee payment failed"); }
        ++completedSales; volume += price; feesCollected += fee;
        emit FeesPaid(tokenId,feeRecipient,buyerFee,sellerFee);
    }
}
