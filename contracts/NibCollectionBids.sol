// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface INibCollectionBidsIdentity { function balanceOf(address) external view returns (uint256); }

/// @notice Collection-wide, escrowed BNB bids on the Nib collection: "I will buy `quantity` Nibs at `price` each".
/// Any holder of any token can sell into a bid (partial fills decrement the remaining quantity). Native BNB only.
/// Fees match NibMarketplace exactly: an immutable 2% buyer fee on top of the price and an immutable 2% seller fee
/// out of it, each rounded down to whole wei per NFT. There is no owner, pause, upgrade or rescue function.
contract NibCollectionBids is ReentrancyGuard {
    using EnumerableSet for EnumerableSet.UintSet;
    struct Bid { address bidder; uint256 price; uint256 quantity; uint256 filled; uint256 expiresAt; }
    uint256 public constant BUYER_FEE_BPS = 200;
    uint256 public constant SELLER_FEE_BPS = 200;
    uint256 public constant MAX_QUANTITY = 10_000;
    IERC721 public immutable collection;
    INibCollectionBidsIdentity public immutable agentIdRegistry;
    address payable public immutable feeRecipient;
    uint256 public bidNonce;
    uint256 public completedSales;
    uint256 public volume;
    uint256 public feesCollected;
    uint256 public escrowedBNB;
    mapping(uint256 => Bid) public bids;
    EnumerableSet.UintSet private activeBids;
    mapping(address => EnumerableSet.UintSet) private bidderBids;
    event BidPlaced(uint256 indexed id, address indexed bidder, uint256 price, uint256 quantity, uint256 deposit, uint256 expiresAt);
    event BidFilled(uint256 indexed id, uint256 indexed tokenId, address indexed bidder, address seller, uint256 price, uint256 remaining);
    event BidCancelled(uint256 indexed id, address indexed bidder, address recipient, uint256 refund, uint256 remaining);
    event FeesPaid(uint256 indexed id, uint256 indexed tokenId, address indexed recipient, uint256 buyerFee, uint256 sellerFee);

    constructor(address collection_, address registry_, address payable feeRecipient_) {
        require(collection_.code.length > 0 && registry_.code.length > 0, "Missing contracts");
        require(feeRecipient_ != address(0) && feeRecipient_ != address(this) && feeRecipient_ != collection_, "Invalid fee recipient");
        collection = IERC721(collection_);
        agentIdRegistry = INibCollectionBidsIdentity(registry_);
        feeRecipient = feeRecipient_;
    }
    /// @dev Identical rounding to NibMarketplace.quote: each fee rounds down to whole wei, per NFT.
    function quote(uint256 price) public pure returns (uint256 buyerFee, uint256 sellerFee, uint256 buyerTotal, uint256 sellerProceeds) {
        buyerFee = price * BUYER_FEE_BPS / 10_000;
        sellerFee = price * SELLER_FEE_BPS / 10_000;
        buyerTotal = price + buyerFee;
        sellerProceeds = price - sellerFee;
    }
    function remaining(uint256 id) public view returns (uint256) { Bid storage b = bids[id]; return b.quantity - b.filled; }
    function bidAvailable(uint256 id) public view returns (bool) {
        Bid memory b = bids[id];
        return b.bidder != address(0) && b.expiresAt > block.timestamp && b.quantity > b.filled && agentIdRegistry.balanceOf(b.bidder) > 0;
    }
    function bidCount() external view returns (uint256) { return activeBids.length(); }
    function bidAt(uint256 index) external view returns (uint256) { return activeBids.at(index); }
    function bidderBidCount(address bidder) external view returns (uint256) { return bidderBids[bidder].length(); }
    function bidderBidAt(address bidder, uint256 index) external view returns (uint256) { return bidderBids[bidder].at(index); }
    function approved(uint256 tokenId, address owner) public view returns (bool) {
        return collection.getApproved(tokenId) == address(this) || collection.isApprovedForAll(owner, address(this));
    }

    /// @notice Escrow exactly quantity * (price + 2% buyer fee) BNB. Cancelling refunds every unfilled unit in full, with no fee.
    function placeBid(uint256 price, uint256 quantity, uint256 expiresAt) external payable nonReentrant returns (uint256 id) {
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Agent ID required");
        require(price > 0 && price <= 1_000_000 ether, "Invalid price");
        require(quantity > 0 && quantity <= MAX_QUANTITY, "Invalid quantity");
        require(expiresAt > block.timestamp && expiresAt <= block.timestamp + 30 days, "Expiry within 30 days");
        (,,uint256 unit,) = quote(price);
        uint256 deposit = unit * quantity;
        require(msg.value == deposit, "Exact bid deposit required");
        id = ++bidNonce;
        bids[id] = Bid(msg.sender, price, quantity, 0, expiresAt);
        activeBids.add(id); bidderBids[msg.sender].add(id);
        escrowedBNB += deposit;
        emit BidPlaced(id, msg.sender, price, quantity, deposit, expiresAt);
    }

    /// @notice Sell one NFT you own into a collection bid. The seller needs an Agent ID and must approve this contract
    /// for that token (or the whole collection) first. Pays the seller price - 2%, the treasury both fees, and the NFT goes to the bidder.
    function acceptBid(uint256 id, uint256 tokenId, address expectedBidder, uint256 expectedPrice, uint256 deadline) external nonReentrant {
        require(block.timestamp <= deadline, "Acceptance expired");
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Seller needs Agent ID");
        Bid memory b = bids[id];
        require(b.bidder != address(0) && b.bidder == expectedBidder && b.price == expectedPrice, "Bid changed/missing");
        require(b.expiresAt > block.timestamp && b.quantity > b.filled, "Bid expired or filled");
        require(b.bidder != msg.sender, "Cannot sell to yourself");
        require(agentIdRegistry.balanceOf(b.bidder) > 0, "Bidder needs Agent ID");
        require(collection.ownerOf(tokenId) == msg.sender, "Only NFT owner");
        require(approved(tokenId, msg.sender), "Approve this NFT");
        (uint256 buyerFee, uint256 sellerFee, uint256 unit, uint256 proceeds) = quote(b.price);
        // Effects before interactions.
        uint256 left = b.quantity - b.filled - 1;
        if (left == 0) { delete bids[id]; activeBids.remove(id); bidderBids[b.bidder].remove(id); }
        else bids[id].filled = b.filled + 1;
        escrowedBNB -= unit;
        ++completedSales; volume += b.price; feesCollected += buyerFee + sellerFee;
        collection.safeTransferFrom(msg.sender, b.bidder, tokenId);
        (bool paid,) = payable(msg.sender).call{value: proceeds}("");
        require(paid, "BNB seller payment failed");
        uint256 fee = buyerFee + sellerFee;
        if (fee > 0) { (bool feePaid,) = feeRecipient.call{value: fee}(""); require(feePaid, "BNB fee payment failed"); }
        emit BidFilled(id, tokenId, b.bidder, msg.sender, b.price, left);
        emit FeesPaid(id, tokenId, feeRecipient, buyerFee, sellerFee);
    }

    /// @notice Bidder-only. Always available (expired, partially filled, or without an Agent ID). Refunds every unfilled unit
    /// in full to `recipient` immediately; no trading fee is charged.
    function cancelBid(uint256 id, address payable recipient) external nonReentrant {
        Bid memory b = bids[id];
        require(b.bidder == msg.sender, "Bid not yours/missing");
        require(recipient != address(0) && recipient != address(this), "Invalid refund recipient");
        uint256 left = b.quantity - b.filled;
        (,,uint256 unit,) = quote(b.price);
        uint256 refund = unit * left;
        delete bids[id]; activeBids.remove(id); bidderBids[msg.sender].remove(id);
        escrowedBNB -= refund;
        (bool paid,) = recipient.call{value: refund}("");
        require(paid, "BNB refund failed");
        emit BidCancelled(id, msg.sender, recipient, refund, left);
    }
}
