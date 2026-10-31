// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface INibBugBountyIdentity { function balanceOf(address) external view returns (uint256); }

/// @title NibBugBounty
/// @notice Escrowed NIB bug bounties for Binance agents. Projects fund a bounty up front with fixed severity payouts; hunters
/// commit a hash of their report (the report itself stays off-chain, only hashes are ever on-chain), reveal the hash, and the
/// project accepts or rejects within its declared review window. Disputes go to a neutral arbiter with a timeout.
///
/// TRUST MODEL (read this before using it):
///  * Escrow is held by this contract only. There is NO owner, pause, upgrade or rescue function. Nobody (not the deployer, not the
///    arbiter, not the fee recipient) can move escrowed funds anywhere except to the hunter, the creator, the fee recipient (fee only)
///    and the burn address, following the state machine below.
///  * The ARBITER can only choose how much of a disputed submission's *already reserved* payout the hunter gets (never more than the
///    hunter's claimed tier) and whether a rejected hunter's stake is returned or burned. It cannot redirect funds to itself or to
///    anyone else. It is a single address (the treasury at launch); it can hand the role to another address through a public,
///    14-day-delayed two-step rotation. It is a trusted party for dispute outcomes - that is the one centralisation in this design.
///  * Everything else is trustless: every wait is bounded by a permissionless timeout (anyone can call finalise / expire / timeout).
contract NibBugBounty is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---- rules (constants) ----
    uint256 public constant MAX_TIERS = 4;
    uint256 public constant MIN_DURATION = 14 days;
    uint256 public constant MAX_DURATION = 365 days;
    uint256 public constant MIN_REVIEW_WINDOW = 3 days;
    uint256 public constant MAX_REVIEW_WINDOW = 30 days;
    uint256 public constant REVEAL_WINDOW = 24 hours;
    uint256 public constant DISPUTE_WINDOW = 3 days;
    uint256 public constant ARBITER_TIMEOUT = 14 days;
    uint256 public constant CANCEL_COOLDOWN = 7 days;
    uint256 public constant ARBITER_CHANGE_DELAY = 14 days;
    uint256 public constant MAX_OPEN_SUBMISSIONS = 20;      // unresolved submissions per bounty
    uint256 public constant MAX_ACTIVE_PER_HUNTER = 3;      // unresolved submissions per hunter per bounty
    uint256 public constant MAX_FEE_BPS = 500;              // the protocol fee can never exceed 5%
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    // ---- immutable economics ----
    IERC20 public immutable nib;
    INibBugBountyIdentity public immutable agentIdRegistry;
    address public immutable feeRecipient;
    uint256 public immutable feeBps;          // taken from the hunter's payout (never from the stake), paid to feeRecipient
    uint256 public immutable minDeposit;      // minimum NIB a bounty must escrow at creation
    uint256 public immutable minLowestTier;   // minimum payout of the lowest severity tier

    enum Status { None, Committed, Revealed, Decided, Disputed, Settled, Expired }
    /// reasons for a rejection. Duplicate returns the hunter's stake; the others burn it unless the arbiter overturns.
    enum Reason { None, Duplicate, NotAVulnerability, OutOfScope, NotReproducible }

    struct Bounty {
        address creator; uint64 createdAt; uint64 endsAt; uint64 cancelRequestedAt;
        uint32 reviewWindow; uint32 tierCount; uint32 pending; uint32 submissionCount; bool closed;
        uint256 stake; uint256 available; uint256 reserved; bytes32 scopeHash; uint256[4] tiers;
    }
    struct Submission {
        uint256 bountyId; address hunter; Status status; uint8 claimed; uint8 awarded; Reason reason; bool escalated;
        bytes32 commitHash; bytes32 reportHash; uint64 committedAt; uint64 revealedAt; uint64 deadline; uint256 duplicateOf;
        uint256 stake; uint256 bond;
    }
    struct CreatorStats { uint32 bounties; uint32 paid; uint32 rejected; uint32 overturned; uint32 silent; uint256 paidTotal; }
    struct HunterStats { uint32 paid; uint32 rejected; uint256 earned; }

    uint256 public bountyNonce;
    uint256 public submissionNonce;
    uint256 public totalEscrow;   // sum of (available + reserved) across bounties
    uint256 public totalStakes;   // sum of stakes and bonds held for unresolved submissions
    uint256 public totalPaid;     // NIB paid to hunters (net of fee)
    uint256 public totalFees;
    uint256 public totalBurned;
    address public arbiter;
    address public pendingArbiter;
    uint256 public pendingArbiterAt;
    mapping(uint256 => Bounty) private _bounties;
    mapping(uint256 => Submission) private _subs;
    mapping(uint256 => uint256[]) private _bountySubs;
    mapping(address => uint256[]) private _hunterSubs;
    mapping(uint256 => mapping(bytes32 => bool)) public commitUsed;
    mapping(uint256 => mapping(address => uint256)) public hunterActive;
    mapping(address => CreatorStats) public creatorStats;
    mapping(address => HunterStats) public hunterStats;

    event BountyCreated(uint256 indexed id, address indexed creator, bytes32 scopeHash, uint256[] tiers, uint256 endsAt, uint256 reviewWindow, uint256 stake, uint256 deposit);
    event BountyToppedUp(uint256 indexed id, uint256 amount, uint256 available);
    event BountyExtended(uint256 indexed id, uint256 endsAt);
    event CancelRequested(uint256 indexed id, uint256 closesAt);
    event BountyWithdrawn(uint256 indexed id, address indexed creator, uint256 amount);
    event Committed(uint256 indexed id, uint256 indexed bountyId, address indexed hunter, bytes32 commitHash, uint256 revealBy);
    event Revealed(uint256 indexed id, uint256 indexed bountyId, address indexed hunter, uint8 severity, bytes32 reportHash, uint256 reviewBy);
    event Rejected(uint256 indexed id, uint256 indexed bountyId, Reason reason, uint256 duplicateOf, uint256 disputeBy);
    event Accepted(uint256 indexed id, uint256 indexed bountyId, uint8 severity, bool full, uint256 disputeBy);
    event Escalated(uint256 indexed id, uint256 indexed bountyId, bool projectSilent, uint256 arbiterBy);
    event Expired(uint256 indexed id, uint256 indexed bountyId, uint256 stakeToCreator);
    event Settled(uint256 indexed id, uint256 indexed bountyId, address indexed hunter, uint8 awarded, uint256 payout, uint256 fee, uint256 stakeReturned, uint256 burned, string how);
    event ArbiterProposed(address indexed proposed, uint256 effectiveAt);
    event ArbiterChanged(address indexed previous, address indexed current);

    constructor(address nib_, address registry_, address arbiter_, address feeRecipient_, uint256 feeBps_, uint256 minDeposit_, uint256 minLowestTier_) {
        require(nib_.code.length > 0 && registry_.code.length > 0, "Missing contracts");
        require(arbiter_ != address(0) && arbiter_ != address(this) && arbiter_ != nib_, "Invalid arbiter");
        require(feeRecipient_ != address(0) && feeRecipient_ != address(this) && feeRecipient_ != nib_, "Invalid fee recipient");
        require(feeBps_ <= MAX_FEE_BPS, "Fee too high");
        require(minLowestTier_ >= 100 && minDeposit_ >= minLowestTier_, "Invalid minimums");
        nib = IERC20(nib_); agentIdRegistry = INibBugBountyIdentity(registry_); arbiter = arbiter_; feeRecipient = feeRecipient_;
        feeBps = feeBps_; minDeposit = minDeposit_; minLowestTier = minLowestTier_;
    }

    // ------------------------------------------------------------------ views
    function getBounty(uint256 id) external view returns (Bounty memory) { return _bounties[id]; }
    function getSubmission(uint256 id) external view returns (Submission memory) { return _subs[id]; }
    function submissionsOf(uint256 bountyId) external view returns (uint256[] memory) { return _bountySubs[bountyId]; }
    function hunterSubmissions(address hunter) external view returns (uint256[] memory) { return _hunterSubs[hunter]; }
    function tierPayout(uint256 bountyId, uint256 severity) public view returns (uint256) {
        Bounty storage b = _bounties[bountyId];
        require(severity >= 1 && severity <= b.tierCount, "Unknown severity");
        return b.tiers[severity - 1];
    }
    /// @return the time after which no new commits are accepted (the end, or the end of the cancel cooldown if sooner).
    function closesAt(uint256 id) public view returns (uint256) {
        Bounty storage b = _bounties[id];
        if (b.cancelRequestedAt == 0) return b.endsAt;
        uint256 c = uint256(b.cancelRequestedAt) + CANCEL_COOLDOWN;
        return c < b.endsAt ? c : b.endsAt;
    }
    function isOpen(uint256 id) public view returns (bool) { Bounty storage b = _bounties[id]; return b.creator != address(0) && !b.closed && block.timestamp < closesAt(id); }
    /// @return how many more top-tier-sized commits the escrow can currently back.
    function freeSlots(uint256 id) external view returns (uint256) { Bounty storage b = _bounties[id]; return b.creator == address(0) ? 0 : b.available / b.tiers[b.tierCount - 1]; }
    function commitHashFor(uint256 bountyId, address hunter, uint8 severity, bytes32 reportHash, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), bountyId, hunter, severity, reportHash, salt));
    }

    // ------------------------------------------------------------------ project side
    /// @notice Create a bounty and escrow `deposit` NIB (approve this contract first). `tiers` are the fixed payouts for severity
    /// 1..n, strictly increasing, declared now and never changeable. The stake is what each hunter must lock per submission.
    function createBounty(bytes32 scopeHash, uint256[] calldata tiers, uint256 endsAt, uint256 reviewWindow, uint256 stake, uint256 deposit) external nonReentrant returns (uint256 id) {
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Agent ID required");
        require(msg.sender != arbiter, "Arbiter cannot create bounties");
        require(scopeHash != bytes32(0), "Scope hash required");
        require(tiers.length >= 1 && tiers.length <= MAX_TIERS, "1 to 4 severity tiers");
        require(tiers[0] >= minLowestTier, "Lowest tier below minimum");
        for (uint256 i = 1; i < tiers.length; i++) require(tiers[i] > tiers[i - 1], "Tiers must strictly increase");
        require(deposit >= minDeposit && deposit >= tiers[tiers.length - 1], "Deposit below minimum or top tier");
        require(deposit <= type(uint128).max, "Deposit too large");
        require(stake >= tiers[0] / 100 && stake <= tiers[0] / 10 && stake > 0, "Stake must be 1%-10% of the lowest tier");
        require(endsAt >= block.timestamp + MIN_DURATION && endsAt <= block.timestamp + MAX_DURATION, "Duration out of range");
        require(reviewWindow >= MIN_REVIEW_WINDOW && reviewWindow <= MAX_REVIEW_WINDOW, "Review window out of range");
        id = ++bountyNonce;
        Bounty storage b = _bounties[id];
        b.creator = msg.sender; b.createdAt = uint64(block.timestamp); b.endsAt = uint64(endsAt); b.reviewWindow = uint32(reviewWindow);
        b.tierCount = uint32(tiers.length); b.stake = stake; b.available = deposit; b.scopeHash = scopeHash;
        for (uint256 i = 0; i < tiers.length; i++) b.tiers[i] = tiers[i];
        totalEscrow += deposit; creatorStats[msg.sender].bounties++;
        _pull(msg.sender, deposit);
        emit BountyCreated(id, msg.sender, scopeHash, tiers, endsAt, reviewWindow, stake, deposit);
    }
    function topUp(uint256 id, uint256 amount) external nonReentrant {
        Bounty storage b = _bounties[id];
        require(b.creator == msg.sender, "Only the creator");
        require(isOpen(id) && b.cancelRequestedAt == 0, "Bounty not open");
        require(amount > 0 && b.available + amount <= type(uint128).max, "Invalid amount");
        b.available += amount; totalEscrow += amount;
        _pull(msg.sender, amount);
        emit BountyToppedUp(id, amount, b.available);
    }
    /// @notice Only ever lengthens a bounty, so a creator can never shorten the window hunters planned around.
    function extend(uint256 id, uint256 newEndsAt) external {
        Bounty storage b = _bounties[id];
        require(b.creator == msg.sender, "Only the creator");
        require(isOpen(id) && b.cancelRequestedAt == 0, "Bounty not open");
        require(newEndsAt > b.endsAt && newEndsAt <= block.timestamp + MAX_DURATION, "Invalid end time");
        b.endsAt = uint64(newEndsAt);
        emit BountyExtended(id, newEndsAt);
    }
    /// @notice Start an early close. New commits keep being accepted for CANCEL_COOLDOWN so hunters mid-research are not cut off.
    function requestCancel(uint256 id) external {
        Bounty storage b = _bounties[id];
        require(b.creator == msg.sender, "Only the creator");
        require(isOpen(id) && b.cancelRequestedAt == 0, "Bounty not open or already closing");
        b.cancelRequestedAt = uint64(block.timestamp);
        emit CancelRequested(id, closesAt(id));
    }
    /// @notice Recover whatever is not reserved - only after the bounty has ended/cooled down AND no submission is unresolved.
    function withdraw(uint256 id) external nonReentrant {
        Bounty storage b = _bounties[id];
        require(b.creator == msg.sender, "Only the creator");
        require(!b.closed, "Already withdrawn");
        require(block.timestamp >= closesAt(id), "Bounty still open");
        require(b.pending == 0, "Submissions still pending");
        uint256 amount = b.available;
        b.closed = true; b.available = 0; totalEscrow -= amount;
        if (amount > 0) nib.safeTransfer(msg.sender, amount);
        emit BountyWithdrawn(id, msg.sender, amount);
    }

    /// @notice Pay the hunter's claimed severity in full (immediate), or a lower severity (hunter may accept or dispute).
    function accept(uint256 submissionId, uint8 severity) external nonReentrant {
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId];
        require(b.creator == msg.sender, "Only the creator");
        require(s.status == Status.Revealed, "Not awaiting review");
        require(severity >= 1 && severity <= s.claimed, "Severity must be within the claimed tier");
        s.awarded = severity;
        if (severity == s.claimed) { emit Accepted(submissionId, s.bountyId, severity, true, 0); _settle(submissionId, severity, true, true, "accepted"); return; }
        s.status = Status.Decided; s.deadline = uint64(block.timestamp + DISPUTE_WINDOW);
        emit Accepted(submissionId, s.bountyId, severity, false, s.deadline);
    }
    /// @notice Reject with a mandatory reason. A duplicate must point at an EARLIER valid submission on the same bounty, so the earliest
    /// valid commit always wins and a project cannot call a report a duplicate of something that was committed after it.
    function reject(uint256 submissionId, Reason reason, uint256 duplicateOf) external nonReentrant {
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId];
        require(b.creator == msg.sender, "Only the creator");
        require(s.status == Status.Revealed, "Not awaiting review");
        require(reason != Reason.None, "Reason required");
        if (reason == Reason.Duplicate) {
            Submission storage t = _subs[duplicateOf];
            require(duplicateOf != 0 && duplicateOf < submissionId && t.bountyId == s.bountyId && t.hunter != s.hunter, "Duplicate must reference an earlier submission");
            require(_validForPriority(t), "Referenced submission is not valid");
        } else require(duplicateOf == 0, "duplicateOf only for duplicates");
        s.reason = reason; s.duplicateOf = duplicateOf; s.awarded = 0;
        s.status = Status.Decided; s.deadline = uint64(block.timestamp + DISPUTE_WINDOW);
        emit Rejected(submissionId, s.bountyId, reason, duplicateOf, s.deadline);
    }

    // ------------------------------------------------------------------ hunter side
    /// @notice Step 1: lock the stake and commit keccak256(abi.encode(chainid, this, bountyId, you, severity, reportHash, salt)).
    /// Nothing about the finding is public. The commit order fixes priority. The escrow for the top tier is reserved for you now.
    function commit(uint256 bountyId, bytes32 commitHash) external nonReentrant returns (uint256 id) {
        Bounty storage b = _bounties[bountyId];
        require(isOpen(bountyId), "Bounty not open");
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Agent ID required");
        require(msg.sender != b.creator && msg.sender != arbiter, "Creator/arbiter cannot submit");
        require(commitHash != bytes32(0) && !commitUsed[bountyId][commitHash], "Commit already used");
        require(b.pending < MAX_OPEN_SUBMISSIONS, "Too many open submissions");
        require(hunterActive[bountyId][msg.sender] < MAX_ACTIVE_PER_HUNTER, "Too many of your submissions are open");
        uint256 top = b.tiers[b.tierCount - 1];
        require(b.available >= top, "Escrow cannot back another top-tier submission yet");
        commitUsed[bountyId][commitHash] = true; hunterActive[bountyId][msg.sender]++;
        b.available -= top; b.reserved += top; b.pending++; b.submissionCount++;
        id = ++submissionNonce;
        Submission storage s = _subs[id];
        s.bountyId = bountyId; s.hunter = msg.sender; s.status = Status.Committed; s.commitHash = commitHash;
        s.committedAt = uint64(block.timestamp); s.deadline = uint64(block.timestamp + REVEAL_WINDOW); s.stake = b.stake;
        _bountySubs[bountyId].push(id); _hunterSubs[msg.sender].push(id);
        totalStakes += b.stake;
        _pull(msg.sender, b.stake);
        emit Committed(id, bountyId, msg.sender, commitHash, s.deadline);
    }
    /// @notice Step 2 (within REVEAL_WINDOW): open the commitment. Fixes your claimed severity and the report hash; the project's
    /// review clock starts now. Upload the report to the private bounty API under this reportHash.
    function reveal(uint256 submissionId, uint8 severity, bytes32 reportHash, bytes32 salt) external nonReentrant {
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId];
        require(s.hunter == msg.sender && s.status == Status.Committed, "Not your open commit");
        require(block.timestamp <= s.deadline, "Reveal window passed");
        require(severity >= 1 && severity <= b.tierCount && reportHash != bytes32(0), "Invalid severity or report hash");
        require(commitHashFor(s.bountyId, msg.sender, severity, reportHash, salt) == s.commitHash, "Reveal does not match commit");
        uint256 release = b.tiers[b.tierCount - 1] - b.tiers[severity - 1];
        b.reserved -= release; b.available += release;
        s.status = Status.Revealed; s.claimed = severity; s.reportHash = reportHash;
        s.revealedAt = uint64(block.timestamp); s.deadline = uint64(block.timestamp + b.reviewWindow);
        emit Revealed(submissionId, s.bountyId, msg.sender, severity, reportHash, s.deadline);
    }
    /// @notice Hunter accepts the project's decision (e.g. a downgrade) and settles immediately.
    function acceptDecision(uint256 submissionId) external nonReentrant {
        Submission storage s = _subs[submissionId];
        require(s.hunter == msg.sender && s.status == Status.Decided, "Not your decided submission");
        _settle(submissionId, s.awarded, s.reason == Reason.Duplicate || s.awarded > 0, true, "hunter accepted decision");
    }
    /// @notice Hunter disputes a project decision within DISPUTE_WINDOW. Locks a bond equal to the stake (returned if the arbiter awards more
    /// than the project did, burned otherwise) so disputes cannot be spammed.
    function dispute(uint256 submissionId) external nonReentrant {
        Submission storage s = _subs[submissionId];
        require(s.hunter == msg.sender && s.status == Status.Decided, "Not your decided submission");
        require(block.timestamp <= s.deadline, "Dispute window passed");
        s.status = Status.Disputed; s.bond = s.stake; s.deadline = uint64(block.timestamp + ARBITER_TIMEOUT);
        totalStakes += s.bond;
        _pull(msg.sender, s.bond);
        emit Escalated(submissionId, s.bountyId, false, s.deadline);
    }
    /// @notice The project never answered inside its review window: the hunter sends it to the arbiter without a bond.
    function escalate(uint256 submissionId) external nonReentrant {
        Submission storage s = _subs[submissionId];
        require(s.hunter == msg.sender && s.status == Status.Revealed, "Not your revealed submission");
        require(block.timestamp > s.deadline, "Project review window still open");
        s.status = Status.Disputed; s.escalated = true; s.deadline = uint64(block.timestamp + ARBITER_TIMEOUT);
        creatorStats[_bounties[s.bountyId].creator].silent++;
        emit Escalated(submissionId, s.bountyId, true, s.deadline);
    }

    // ------------------------------------------------------------------ permissionless timeouts
    /// @notice The hunter never revealed: the stake goes to the project (compensation for the time its escrow was locked), the reservation frees.
    function expireCommit(uint256 submissionId) external nonReentrant {
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId];
        require(s.status == Status.Committed && block.timestamp > s.deadline, "Not expired");
        uint256 top = b.tiers[b.tierCount - 1]; uint256 stake = s.stake;
        b.reserved -= top; b.available += top; b.pending--; hunterActive[s.bountyId][s.hunter]--;
        s.status = Status.Expired; totalStakes -= stake;
        nib.safeTransfer(b.creator, stake);
        emit Expired(submissionId, s.bountyId, stake);
    }
    /// @notice The hunter did not dispute inside DISPUTE_WINDOW: the project's decision stands.
    function finalize(uint256 submissionId) external nonReentrant {
        Submission storage s = _subs[submissionId];
        require(s.status == Status.Decided && block.timestamp > s.deadline, "Not finalisable");
        _settle(submissionId, s.awarded, s.reason == Reason.Duplicate || s.awarded > 0, true, "decision stood");
    }
    /// @notice The arbiter did not rule in time. Neutral fallback: the hunter gets the higher of the project's own award and the LOWEST
    /// tier (capped at the claim) and the stake and bond are returned. Nobody is slashed for the arbiter's silence.
    function claimArbiterTimeout(uint256 submissionId) external nonReentrant {
        Submission storage s = _subs[submissionId];
        require(s.status == Status.Disputed && block.timestamp > s.deadline, "Arbiter still has time");
        uint8 award = s.awarded > 0 ? s.awarded : 1;
        if (award > s.claimed) award = s.claimed;
        _settle(submissionId, award, true, true, "arbiter timeout");
    }

    // ------------------------------------------------------------------ arbiter
    /// @notice Rule on a disputed submission. `severity` 0 = reject; never above the claimed tier; the payout always comes from the reserved tier.
    function resolveDispute(uint256 submissionId, uint8 severity, bool returnStake) external nonReentrant {
        require(msg.sender == arbiter, "Only the arbiter");
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId];
        require(s.status == Status.Disputed, "Not disputed");
        require(msg.sender != s.hunter && msg.sender != b.creator, "Arbiter is a party");
        require(severity <= s.claimed, "Above claimed tier");
        bool overturned = severity > s.awarded;
        if (overturned) creatorStats[b.creator].overturned++;
        // The bond comes back only if the arbiter sided with the hunter beyond what the project had offered (or the project was silent).
        _settle(submissionId, severity, severity > 0 || returnStake, overturned, "arbiter ruling");
    }
    function proposeArbiter(address next) external {
        require(msg.sender == arbiter, "Only the arbiter");
        require(next != address(0) && next != arbiter && next != address(this) && next != address(nib), "Invalid arbiter");
        pendingArbiter = next; pendingArbiterAt = block.timestamp + ARBITER_CHANGE_DELAY;
        emit ArbiterProposed(next, pendingArbiterAt);
    }
    function cancelArbiterChange() external {
        require(msg.sender == arbiter, "Only the arbiter");
        pendingArbiter = address(0); pendingArbiterAt = 0;
    }
    function acceptArbiter() external {
        require(pendingArbiter != address(0) && msg.sender == pendingArbiter && block.timestamp >= pendingArbiterAt, "Not ready");
        emit ArbiterChanged(arbiter, msg.sender);
        arbiter = msg.sender; pendingArbiter = address(0); pendingArbiterAt = 0;
    }

    // ------------------------------------------------------------------ internals
    function _validForPriority(Submission storage t) private view returns (bool) {
        return t.status == Status.Revealed || t.status == Status.Disputed || ((t.status == Status.Decided || t.status == Status.Settled) && t.awarded > 0);
    }
    function _settle(uint256 id, uint8 awarded, bool stakeBack, bool bondBack, string memory how) private {
        Submission storage s = _subs[id]; Bounty storage b = _bounties[s.bountyId];
        uint256 claimedPay = b.tiers[s.claimed - 1];
        uint256 pay = awarded > 0 ? b.tiers[awarded - 1] : 0;
        uint256 fee = pay * feeBps / 10_000;
        uint256 stake = s.stake; uint256 bond = s.bond;
        uint256 back = (stakeBack ? stake : 0) + (bondBack ? bond : 0);
        uint256 burned = (stake + bond) - back;
        b.reserved -= claimedPay; b.available += claimedPay - pay; b.pending--; hunterActive[s.bountyId][s.hunter]--;
        s.status = Status.Settled; s.awarded = awarded;
        totalEscrow -= pay; totalStakes -= (stake + bond);
        if (awarded > 0) {
            creatorStats[b.creator].paid++; creatorStats[b.creator].paidTotal += pay;
            hunterStats[s.hunter].paid++; hunterStats[s.hunter].earned += pay - fee; totalPaid += pay - fee;
        } else { creatorStats[b.creator].rejected++; hunterStats[s.hunter].rejected++; }
        totalFees += fee; totalBurned += burned;
        uint256 toHunter = pay - fee + back;
        if (toHunter > 0) nib.safeTransfer(s.hunter, toHunter);
        if (fee > 0) nib.safeTransfer(feeRecipient, fee);
        if (burned > 0) nib.safeTransfer(BURN, burned);
        emit Settled(id, s.bountyId, s.hunter, awarded, pay - fee, fee, back, burned, how);
    }
    function _pull(address from, uint256 amount) private {
        uint256 before = nib.balanceOf(address(this));
        nib.safeTransferFrom(from, address(this), amount);
        require(nib.balanceOf(address(this)) - before == amount, "Fee-on-transfer tokens unsupported");
    }
}
