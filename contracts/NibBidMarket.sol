// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Bid-only NIB pre-market. Buyers escrow BNB for a fixed NIB quantity at their own price; holders can only sell by
/// accepting a bid (fully or partially). There are no listings, no order matching and no owner control over escrowed BNB.
/// Fees mirror NibMarketplace: the buyer pays +2% on top of the filled BNB, the seller receives -2% of it, both go to the treasury.
/// The treasury may pause NEW bids only; accepting, cancelling and withdrawing always work.
contract NibBidMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    /// @dev bnbRemaining and feeRemaining are escrowed BNB: the bid's unfilled notional and its pre-paid buyer fee.
    struct Bid { address bidder; uint64 expiresAt; uint128 nibRemaining; uint128 bnbRemaining; uint128 feeRemaining; }
    struct BidView { uint256 id; address bidder; uint64 expiresAt; uint128 nibRemaining; uint128 bnbRemaining; uint128 feeRemaining; uint256 priceE18; }

    uint256 public constant BUYER_FEE_BPS = 200;
    uint256 public constant SELLER_FEE_BPS = 200;
    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_BID_BNB = 0.001 ether; // minimum BNB notional (fee excluded) of a new bid
    uint256 public constant MAX_NIB_PER_BID = 1_000_000_000 ether; // total NIB supply
    uint256 public constant MAX_EXPIRY = 365 days;
    uint256 private constant PAYOUT_GAS = 100_000; // a payout that cannot be sent within this becomes a withdrawable credit

    IERC20 public immutable nib;
    /// @notice Receives all fees and is the only account that can pause new bids.
    address payable public immutable treasury;

    bool public paused;
    uint256 public bidNonce;
    uint256 public totalEscrow; // sum of bnbRemaining + feeRemaining across live bids
    uint256 public totalCredits; // BNB owed to accounts whose address rejected a payout
    uint256 public fills;
    uint256 public volumeBNB;
    uint256 public volumeNIB;
    uint256 public feesCollected;
    mapping(uint256 => Bid) private _bids;
    mapping(address => uint256) public credits;
    EnumerableSet.UintSet private _active;
    mapping(address => EnumerableSet.UintSet) private _bidderBids;

    event BidPlaced(uint256 indexed id, address indexed bidder, uint256 nibAmount, uint256 bnbAmount, uint256 buyerFee, uint256 priceE18, uint256 expiresAt);
    event BidCancelled(uint256 indexed id, address indexed bidder, uint256 nibRemaining, uint256 refund);
    event BidAccepted(uint256 indexed id, address indexed bidder, address indexed seller, uint256 nibAmount, uint256 bnbAmount, uint256 buyerFee, uint256 sellerFee, uint256 nibRemaining, uint256 bnbRemaining);
    event CreditAccrued(address indexed account, uint256 amount);
    event CreditWithdrawn(address indexed account, address indexed recipient, uint256 amount);
    event PausedSet(bool paused);

    constructor(address nib_, address payable treasury_) {
        require(nib_.code.length > 0, "NIB must be a contract");
        require(treasury_ != address(0) && treasury_ != address(this) && treasury_ != nib_, "Invalid treasury");
        nib = IERC20(nib_);
        treasury = treasury_;
    }

    // ---------------------------------------------------------------- views
    /// @notice BNB the buyer must send to escrow a bid of this notional, and the part of it that is the pre-paid fee.
    function quoteBid(uint256 bnbAmount) public pure returns (uint256 buyerFee, uint256 deposit) {
        buyerFee = bnbAmount * BUYER_FEE_BPS / BPS;
        deposit = bnbAmount + buyerFee;
    }
    /// @notice What a seller receives and what the buyer pays (before dust rules) when `nibAmount` of bid `id` is accepted.
    function quoteAccept(uint256 id, uint256 nibAmount) external view returns (uint256 bnbAmount, uint256 buyerFee, uint256 sellerFee, uint256 sellerProceeds) {
        Bid memory b = _bids[id];
        require(b.bidder != address(0) && nibAmount > 0 && nibAmount <= b.nibRemaining, "Bad bid or amount");
        (bnbAmount, buyerFee) = _fillAmounts(b, nibAmount);
        sellerFee = bnbAmount * SELLER_FEE_BPS / BPS;
        sellerProceeds = bnbAmount - sellerFee;
    }
    function isLive(uint256 id) public view returns (bool) {
        Bid storage b = _bids[id];
        return b.bidder != address(0) && (b.expiresAt == 0 || b.expiresAt > block.timestamp);
    }
    function getBid(uint256 id) external view returns (BidView memory) { return _view(id, _bids[id]); }
    function activeCount() external view returns (uint256) { return _active.length(); }
    function activeAt(uint256 index) external view returns (uint256) { return _active.at(index); }
    function bidderBidCount(address bidder) external view returns (uint256) { return _bidderBids[bidder].length(); }
    function bidderBidAt(address bidder, uint256 index) external view returns (uint256) { return _bidderBids[bidder].at(index); }
    /// @notice One-call page of open bids (includes expired-but-uncancelled ones; check expiresAt). For the website and agents.
    function activeBids(uint256 offset, uint256 limit) external view returns (BidView[] memory out) {
        uint256 n = _active.length();
        if (offset >= n) return out;
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new BidView[](end - offset);
        for (uint256 i = offset; i < end; i++) { uint256 id = _active.at(i); out[i - offset] = _view(id, _bids[id]); }
    }
    function bidderBids(address bidder, uint256 offset, uint256 limit) external view returns (BidView[] memory out) {
        EnumerableSet.UintSet storage s = _bidderBids[bidder];
        uint256 n = s.length();
        if (offset >= n) return out;
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new BidView[](end - offset);
        for (uint256 i = offset; i < end; i++) { uint256 id = s.at(i); out[i - offset] = _view(id, _bids[id]); }
    }
    function _view(uint256 id, Bid memory b) private pure returns (BidView memory) {
        return BidView(id, b.bidder, b.expiresAt, b.nibRemaining, b.bnbRemaining, b.feeRemaining, b.nibRemaining == 0 ? 0 : uint256(b.bnbRemaining) * 1e18 / b.nibRemaining);
    }

    // ---------------------------------------------------------------- buyers
    /// @notice Escrow BNB to buy `nibAmount` NIB for `bnbAmount` BNB (price = bnbAmount / nibAmount). Send exactly bnbAmount + 2%.
    /// @param expiresAt Unix time after which the bid can no longer be accepted, or 0 for good-till-cancelled. Cancelling always works.
    function placeBid(uint256 nibAmount, uint256 bnbAmount, uint256 expiresAt) external payable nonReentrant returns (uint256 id) {
        require(!paused, "New bids are paused");
        require(bnbAmount >= MIN_BID_BNB, "Bid below minimum");
        require(nibAmount > 0 && nibAmount <= MAX_NIB_PER_BID, "Invalid NIB amount");
        require(bnbAmount <= 1_000_000 ether, "Bid too large");
        require(expiresAt == 0 || (expiresAt > block.timestamp && expiresAt <= block.timestamp + MAX_EXPIRY), "Invalid expiry");
        (uint256 buyerFee, uint256 deposit) = quoteBid(bnbAmount);
        require(msg.value == deposit, "Send exactly the bid plus 2%");
        id = ++bidNonce;
        // Casts are safe: bnbAmount <= 1e24, fee <= 2e22, nibAmount <= 1e27, expiry < 2^64 (bounded above).
        _bids[id] = Bid(msg.sender, uint64(expiresAt), uint128(nibAmount), uint128(bnbAmount), uint128(buyerFee));
        _active.add(id);
        _bidderBids[msg.sender].add(id);
        totalEscrow += deposit;
        emit BidPlaced(id, msg.sender, nibAmount, bnbAmount, buyerFee, bnbAmount * 1e18 / nibAmount, expiresAt);
    }

    /// @notice Cancel a bid and get back all remaining BNB including its unspent fee. Never charged a fee, never blocked by pause or expiry.
    function cancelBid(uint256 id) external nonReentrant {
        Bid memory b = _bids[id];
        require(b.bidder == msg.sender, "Bid not yours or missing");
        uint256 refund = uint256(b.bnbRemaining) + b.feeRemaining;
        _remove(id, b.bidder);
        totalEscrow -= refund;
        emit BidCancelled(id, msg.sender, b.nibRemaining, refund);
        _pay(msg.sender, refund);
    }

    // ---------------------------------------------------------------- sellers
    /// @notice Sell `nibAmount` NIB into bid `id` (full or partial). The seller must have approved this contract for the NIB first.
    /// @param minBnbOut Slippage guard on the BNB the seller receives after the 2% seller fee.
    function acceptBid(uint256 id, uint256 nibAmount, uint256 minBnbOut, uint256 deadline) external nonReentrant {
        require(block.timestamp <= deadline, "Acceptance expired");
        Bid memory b = _bids[id];
        require(b.bidder != address(0), "Bid missing or filled");
        require(b.expiresAt == 0 || b.expiresAt > block.timestamp, "Bid expired");
        require(b.bidder != msg.sender, "Cannot accept your own bid");
        require(nibAmount > 0 && nibAmount <= b.nibRemaining, "Invalid NIB amount");
        (uint256 bnbAmount, uint256 buyerFee) = _fillAmounts(b, nibAmount);
        require(bnbAmount > 0, "Fill too small");
        uint256 sellerFee = bnbAmount * SELLER_FEE_BPS / BPS;
        uint256 proceeds = bnbAmount - sellerFee;
        require(proceeds >= minBnbOut, "Below minimum BNB");
        // Effects
        uint128 nibLeft = b.nibRemaining - uint128(nibAmount);
        if (nibLeft == 0) {
            _remove(id, b.bidder);
        } else {
            _bids[id].nibRemaining = nibLeft;
            _bids[id].bnbRemaining = b.bnbRemaining - uint128(bnbAmount);
            _bids[id].feeRemaining = b.feeRemaining - uint128(buyerFee);
        }
        totalEscrow -= bnbAmount + buyerFee;
        ++fills; volumeBNB += bnbAmount; volumeNIB += nibAmount; feesCollected += buyerFee + sellerFee;
        emit BidAccepted(id, b.bidder, msg.sender, nibAmount, bnbAmount, buyerFee, sellerFee, nibLeft, nibLeft == 0 ? 0 : b.bnbRemaining - bnbAmount);
        // Interactions: NIB goes straight from the seller to the buyer; if it fails the whole call reverts.
        nib.safeTransferFrom(msg.sender, b.bidder, nibAmount);
        _pay(msg.sender, proceeds);
        _pay(treasury, buyerFee + sellerFee);
    }

    /// @dev Pro-rata share of the escrow. A full fill takes everything left, so no BNB wei is ever stranded; partial fills round
    /// the seller's BNB down (never above the bid price) and the buyer never pays more than they escrowed.
    function _fillAmounts(Bid memory b, uint256 nibAmount) private pure returns (uint256 bnbAmount, uint256 buyerFee) {
        if (nibAmount == b.nibRemaining) return (b.bnbRemaining, b.feeRemaining);
        bnbAmount = uint256(b.bnbRemaining) * nibAmount / b.nibRemaining;
        buyerFee = uint256(b.feeRemaining) * nibAmount / b.nibRemaining;
    }

    // ---------------------------------------------------------------- payouts
    function _remove(uint256 id, address bidder) private {
        delete _bids[id];
        _active.remove(id);
        _bidderBids[bidder].remove(id);
    }
    /// @dev Never lets a hostile recipient block a trade or a cancel: a failed send is credited and can be withdrawn later.
    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{value: amount, gas: PAYOUT_GAS}("");
        if (!ok) { credits[to] += amount; totalCredits += amount; emit CreditAccrued(to, amount); }
    }
    /// @notice Withdraw BNB that could not be sent directly (for example to a contract that rejected it).
    function withdrawCredit(address payable recipient) external nonReentrant {
        require(recipient != address(0) && recipient != address(this), "Invalid recipient");
        uint256 amount = credits[msg.sender];
        require(amount > 0, "No credit");
        credits[msg.sender] = 0; totalCredits -= amount;
        emit CreditWithdrawn(msg.sender, recipient, amount);
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, "BNB transfer failed");
    }

    // ---------------------------------------------------------------- pause
    /// @notice Pauses or resumes NEW bids only. Cannot touch, freeze or move any escrowed BNB, accepts or cancels.
    function setPaused(bool value) external {
        require(msg.sender == treasury, "Only treasury");
        paused = value;
        emit PausedSet(value);
    }
}
