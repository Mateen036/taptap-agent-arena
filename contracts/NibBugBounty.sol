// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
interface INibBugBountyIdentity { function balanceOf(address) external view returns (uint256); }

/// @title NibBugBounty
/// @notice Escrowed NIB bug bounties judged by a panel of other TapTap agents. Projects fund a bounty up front with fixed severity payouts.
/// Hunters commit a hash of their report (the report stays off-chain), stake TAP points (off-chain game points, never NIB), and reveal.
/// A panel of 3-9 other agents, drawn at random from volunteers who also stake TAP, votes with commit-reveal. The panel's verdict decides
/// the payout; there is no owner, no arbiter and no admin path to the escrow.
///
/// MONEY (NIB, on-chain, fully escrowed):
///   valid report  -> fee (2%) to the fee recipient, reviewers (20%) split among the reviewers who voted with the outcome, the rest to the hunter.
///   anything else -> the reserved payout goes back to the bounty's balance. The project never pays for a report that is not valid.
/// TAP POINTS (off-chain game points, held by the TapTap server): a signed ticket proves a lock of TAP was taken. This contract records the
/// lock and, once a submission settles, `tapResult(lockId)` states exactly what the server must do with it (return, burn, pay a reward).
/// The ticket signer can only gate WHO may take part (spam control). It cannot move NIB, change a verdict, or pick the panel.
///
/// TRUST MODEL: escrow is held by this contract only. Every wait is bounded by a permissionless timeout. The one rotatable role is the ticket
/// signer (changed by the guardian through a public 7-day delay). A compromised signer could let sybil wallets past the TAP gate; they would
/// still need an Agent ID each and a random draw into a panel, and they risk slashing, but the project's tier payout per report is the exposure.
contract NibBugBounty is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error MissingContracts(); // Missing contracts
    error InvalidSigner(); // Invalid signer
    error InvalidGuardian(); // Invalid guardian
    error InvalidFeeRecipient(); // Invalid fee recipient
    error FeeTooHigh(); // Fee too high
    error ReviewerShareTooHigh(); // Reviewer share too high
    error InvalidMinimums(); // Invalid minimums
    error UnknownSeverity(); // Unknown severity
    error AgentIDRequired(); // Agent ID required
    error RoleHolderCannotCreateBounties(); // Role holder cannot create bounties
    error ScopeHashRequired(); // Scope hash required
    error E1To4SeverityTiers(); // 1 to 4 severity tiers
    error LowestTierBelowMinimum(); // Lowest tier below minimum
    error TiersMustStrictlyIncrease(); // Tiers must strictly increase
    error DepositBelowMinimumOrTop(); // Deposit below minimum or top tier
    error DepositTooLarge(); // Deposit too large
    error TAPStakeMustBe1(); // TAP stake must be 1%-10% of the lowest tier
    error PanelMustBe35(); // Panel must be 3, 5, 7 or 9
    error DurationOutOfRange(); // Duration out of range
    error OnlyTheCreator(); // Only the creator
    error BountyNotOpen(); // Bounty not open
    error InvalidAmount(); // Invalid amount
    error InvalidEndTime(); // Invalid end time
    error BountyNotOpenOrAlready(); // Bounty not open or already closing
    error AlreadyWithdrawn(); // Already withdrawn
    error BountyStillOpen(); // Bounty still open
    error SubmissionsStillPending(); // Submissions still pending
    error NotAllowedToSubmit(); // Not allowed to submit
    error CoolingDownAfterAPenalty(); // Cooling down after a penalty
    error CommitAlreadyUsed(); // Commit already used
    error TooManyOpenSubmissions(); // Too many open submissions
    error TooManyOfYourSubmissions(); // Too many of your submissions are open
    error TooManyOpenSubmissionsOverall(); // Too many open submissions overall
    error TAPStakeBelowTheBounty(); // TAP stake below the bounty's stake
    error EscrowCannotBackAnotherTop(); // Escrow cannot back another top-tier submission yet
    error NotYourOpenCommit(); // Not your open commit
    error RevealWindowPassed(); // Reveal window passed
    error InvalidSeverityOrReportHash(); // Invalid severity or report hash
    error RevealDoesNotMatchCommit(); // Reveal does not match commit
    error NotAnOpenCommit(); // Not an open commit
    error RevealWindowStillOpen(); // Reveal window still open
    error ApplicationsClosed(); // Applications closed
    error ConflictOfInterest(); // Conflict of interest
    error HuntersOfThisBountyCannot(); // Hunters of this bounty cannot review it
    error AlreadyApplied(); // Already applied
    error ApplicantListIsFull(); // Applicant list is full
    error TooManyOpenReviews(); // Too many open reviews
    error NotReadyForSelection(); // Not ready for selection
    error SelectionAlreadyRunning(); // Selection already running
    error NoSelectionRunning(); // No selection running
    error WaitForTheSeedBlock(); // Wait for the seed block
    error SeedBlockExpiredStartThe(); // Seed block expired: start the selection again
    error VotingClosed(); // Voting closed
    error NotASeatedReviewerOr(); // Not a seated reviewer or already voted
    error NotTheRevealPhase(); // Not the reveal phase
    error NoSealedVoteToOpen(); // No sealed vote to open
    error VoteDoesNotMatchThe(); // Vote does not match the sealed vote
    error DuplicateMustReferenceAnEarlier(); // Duplicate must reference an earlier live submission
    error InvalidVerdict(); // Invalid verdict
    error NotUnderJudgment(); // Not under judgment
    error VotesAreStillOpen(); // Votes are still open
    error NothingToClaim(); // Nothing to claim
    error OnlyTheGuardian(); // Only the guardian
    error NotReady(); // Not ready
    error LockAlreadyUsed(); // Lock already used
    error TicketExpired(); // Ticket expired
    error InvalidTAPTicket(); // Invalid TAP ticket
    error FeeOnTransferTokensUnsupported(); // Fee-on-transfer tokens unsupported

    // ---- rules (constants) ----
    uint256 public constant MAX_TIERS = 4;
    uint256 public constant MIN_DURATION = 14 days;
    uint256 public constant MAX_DURATION = 365 days;
    uint256 public constant REVEAL_WINDOW = 24 hours;       // hunter must reveal after committing
    uint256 public constant APPLY_WINDOW = 48 hours;        // volunteers may apply to review after a reveal
    uint256 public constant VOTE_WINDOW = 72 hours;         // sealed votes
    uint256 public constant VOTE_REVEAL_WINDOW = 48 hours;  // votes are opened
    uint256 public constant CANCEL_COOLDOWN = 7 days;
    uint256 public constant SIGNER_CHANGE_DELAY = 7 days;
    uint256 public constant SELECTION_BLOCKS = 200;         // the seed block hash must still be available
    uint256 public constant MIN_PANEL = 3;
    uint256 public constant MAX_PANEL = 9;
    uint256 public constant MAX_APPLICANTS = 40;
    uint256 public constant MAX_OPEN_SUBMISSIONS = 20;      // unresolved submissions per bounty
    uint256 public constant MAX_ACTIVE_PER_HUNTER = 3;      // unresolved submissions per hunter per bounty
    uint256 public constant MAX_ACTIVE_HUNTER_TOTAL = 5;    // unresolved submissions per hunter across all bounties
    uint256 public constant MAX_ACTIVE_REVIEWS = 5;         // open applications or panel seats per reviewer
    uint256 public constant MIN_TAP_STAKE = 500;            // TAP points
    uint256 public constant MAX_STRIKE_DAYS = 7;
    uint256 public constant MAX_FEE_BPS = 500;              // protocol fee never above 5%
    uint256 public constant MAX_REVIEWER_BPS = 3000;        // reviewer share never above 30%
    uint8 public constant VERDICT_DUPLICATE = 255;

    // ---- immutable economics ----
    IERC20 public immutable nib;
    INibBugBountyIdentity public immutable agentIdRegistry;
    address public immutable feeRecipient;
    address public immutable guardian;        // may only rotate the ticket signer (publicly, with a delay)
    uint256 public immutable feeBps;          // taken from a valid payout, paid to feeRecipient
    uint256 public immutable reviewerBps;     // taken from a valid payout, shared by the reviewers who voted with the outcome
    uint256 public immutable minDeposit;
    uint256 public immutable minLowestTier;

    enum Status { None, Committed, Applying, Voting, Settled }
    enum Outcome { None, Valid, Invalid, Duplicate, Inconclusive, NoQuorum, NoPanel, Unrevealed }
    enum Role { None, Hunter, Reviewer }
    enum RState { None, Applied, Selected, NotSelected }

    struct Bounty {
        address creator; uint64 createdAt; uint64 endsAt; uint64 cancelRequestedAt;
        uint32 panelSize; uint32 tierCount; uint32 pending; uint32 submissionCount; bool closed;
        uint256 tapStake; uint256 available; uint256 reserved; bytes32 scopeHash; uint256[4] tiers;
    }
    struct Submission {
        uint256 bountyId; address hunter; Status status; Outcome outcome; uint8 claimed; uint8 awarded; bool extended;
        bytes32 commitHash; bytes32 reportHash; uint64 committedAt; uint64 revealedAt; uint64 deadline; uint64 revealDeadline; uint64 seedBlock;
        uint32 applicants; uint32 commits; uint32 reveals; uint32 aligned; uint256 duplicateOf; uint256 tapStake; bytes32 hunterLock;
    }
    struct Reviewer { RState state; bool committed; bool revealed; bool aligned; uint8 verdict; bytes32 lockId; bytes32 voteHash; uint256 tap; }
    struct Lock { address wallet; Role role; uint256 submissionId; uint256 tap; }

    uint256 public bountyNonce;
    uint256 public submissionNonce;
    uint256 public totalEscrow;      // sum of (available + reserved) across bounties
    uint256 public totalOwed;        // reviewer rewards credited but not yet claimed
    uint256 public totalPaid;        // NIB paid to hunters (net of fee and reviewer share)
    uint256 public totalFees;
    uint256 public totalReviewerPaid;
    address public ticketSigner;
    address public pendingSigner;
    uint256 public pendingSignerAt;
    mapping(uint256 => Bounty) private _bounties;
    mapping(uint256 => Submission) private _subs;
    mapping(uint256 => uint256[]) private _bountySubs;
    mapping(address => uint256[]) private _hunterSubs;
    mapping(address => uint256[]) private _reviewerSubs;
    mapping(uint256 => address[]) private _applicants;
    mapping(uint256 => address[]) private _panel;
    mapping(uint256 => mapping(address => Reviewer)) private _rev;
    mapping(bytes32 => Lock) private _locks;
    mapping(uint256 => mapping(bytes32 => bool)) public commitUsed;
    mapping(uint256 => mapping(address => uint256)) public hunterActive;
    mapping(uint256 => mapping(address => bool)) public hunterInBounty;
    mapping(address => uint256) public hunterActiveTotal;
    mapping(address => uint256) public reviewerActive;
    mapping(address => uint256) public strikes;
    mapping(address => uint256) public cooldownUntil;
    mapping(address => uint256) public rewardOf;

    event BountyCreated(uint256 indexed id, address indexed creator, bytes32 scopeHash, uint256[] tiers, uint256 endsAt, uint256 panelSize, uint256 tapStake, uint256 deposit);
    event BountyToppedUp(uint256 indexed id, uint256 amount, uint256 available);
    event BountyExtended(uint256 indexed id, uint256 endsAt);
    event CancelRequested(uint256 indexed id, uint256 closesAt);
    event BountyWithdrawn(uint256 indexed id, address indexed creator, uint256 amount);
    event Committed(uint256 indexed id, uint256 indexed bountyId, address indexed hunter, bytes32 commitHash, bytes32 lockId, uint256 tap, uint256 revealBy);
    event Revealed(uint256 indexed id, uint256 indexed bountyId, address indexed hunter, uint8 severity, bytes32 reportHash, uint256 applyBy);
    event Applied(uint256 indexed id, address indexed reviewer, bytes32 lockId, uint256 tap, uint256 applicants);
    event ApplyExtended(uint256 indexed id, uint256 applyBy);
    event SelectionStarted(uint256 indexed id, uint256 seedBlock);
    event PanelSelected(uint256 indexed id, address[] panel, uint256 voteBy, uint256 revealBy);
    event VoteCommitted(uint256 indexed id, address indexed reviewer);
    event VoteRevealed(uint256 indexed id, address indexed reviewer, uint8 verdict);
    event Settled(uint256 indexed id, uint256 indexed bountyId, address indexed hunter, uint8 outcome, uint8 awarded, uint256 hunterPay, uint256 fee, uint256 reviewerPool, uint256 alignedReviewers);
    event RewardClaimed(address indexed reviewer, uint256 amount);
    event SignerProposed(address indexed proposed, uint256 effectiveAt);
    event SignerChanged(address indexed previous, address indexed current);

    constructor(address nib_, address registry_, address signer_, address guardian_, address feeRecipient_, uint256 feeBps_, uint256 reviewerBps_, uint256 minDeposit_, uint256 minLowestTier_) {
        require(nib_.code.length > 0 && registry_.code.length > 0, MissingContracts());
        require(signer_ != address(0) && signer_ != address(this) && signer_ != nib_, InvalidSigner());
        require(guardian_ != address(0) && guardian_ != address(this) && guardian_ != nib_, InvalidGuardian());
        require(feeRecipient_ != address(0) && feeRecipient_ != address(this) && feeRecipient_ != nib_, InvalidFeeRecipient());
        require(feeBps_ <= MAX_FEE_BPS, FeeTooHigh());
        require(reviewerBps_ <= MAX_REVIEWER_BPS, ReviewerShareTooHigh());
        require(minLowestTier_ >= 100 && minDeposit_ >= minLowestTier_, InvalidMinimums());
        nib = IERC20(nib_); agentIdRegistry = INibBugBountyIdentity(registry_); ticketSigner = signer_; guardian = guardian_; feeRecipient = feeRecipient_;
        feeBps = feeBps_; reviewerBps = reviewerBps_; minDeposit = minDeposit_; minLowestTier = minLowestTier_;
    }

    // ------------------------------------------------------------------ views
    function getBounty(uint256 id) external view returns (Bounty memory) { return _bounties[id]; }
    function getSubmission(uint256 id) external view returns (Submission memory) { return _subs[id]; }
    function getReviewer(uint256 id, address who) external view returns (Reviewer memory) { return _rev[id][who]; }
    function submissionsOf(uint256 bountyId) external view returns (uint256[] memory) { return _bountySubs[bountyId]; }
    function hunterSubmissions(address hunter) external view returns (uint256[] memory) { return _hunterSubs[hunter]; }
    function reviewerSubmissions(address who) external view returns (uint256[] memory) { return _reviewerSubs[who]; }
    function applicantsOf(uint256 id) external view returns (address[] memory) { return _applicants[id]; }
    function panelOf(uint256 id) external view returns (address[] memory) { return _panel[id]; }
    function quorum(uint256 panelSize) public pure returns (uint256) { return (2 * panelSize + 2) / 3; }
    /// @return the least TAP stake a bounty with this lowest tier may demand: 1% of the tier at 10 TAP per NIB, never below MIN_TAP_STAKE.
    function minTapStake(uint256 lowestTier) public pure returns (uint256) { uint256 t = lowestTier / 1e19; return t < MIN_TAP_STAKE ? MIN_TAP_STAKE : t; }
    function tierPayout(uint256 bountyId, uint256 severity) public view returns (uint256) {
        Bounty storage b = _bounties[bountyId];
        require(severity >= 1 && severity <= b.tierCount, UnknownSeverity());
        return b.tiers[severity - 1];
    }
    function closesAt(uint256 id) public view returns (uint256) {
        Bounty storage b = _bounties[id];
        if (b.cancelRequestedAt == 0) return b.endsAt;
        uint256 c = uint256(b.cancelRequestedAt) + CANCEL_COOLDOWN;
        return c < b.endsAt ? c : b.endsAt;
    }
    function isOpen(uint256 id) public view returns (bool) { Bounty storage b = _bounties[id]; return b.creator != address(0) && !b.closed && block.timestamp < closesAt(id); }
    function freeSlots(uint256 id) external view returns (uint256) { Bounty storage b = _bounties[id]; return b.creator == address(0) ? 0 : b.available / b.tiers[b.tierCount - 1]; }
    function commitHashFor(uint256 bountyId, address hunter, uint8 severity, bytes32 reportHash, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), bountyId, hunter, severity, reportHash, salt));
    }
    function voteHashFor(uint256 submissionId, address reviewer, uint8 verdict, uint256 duplicateOf, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), submissionId, reviewer, verdict, duplicateOf, salt));
    }
    /// @notice What the TAP ticket signer signs. kind 1 = hunter commit (scopeId = bounty id), kind 2 = reviewer application (scopeId = submission id).
    function ticketDigest(uint8 kind, address wallet, uint256 scopeId, uint256 tap, bytes32 lockId, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode("TAPTAP_BUG_BOUNTY_TICKET_V1", block.chainid, address(this), kind, wallet, scopeId, tap, lockId, deadline));
    }
    /// @notice What the TAP server must do with a lock. `final` turns true exactly once; `returned + burned` equals the staked amount and
    /// `reward` is extra TAP to credit (the forfeited hunter stake of an invalid report, shared by the reviewers who voted with the outcome).
    function tapResult(bytes32 lockId) external view returns (bool final_, uint256 returned, uint256 reward, uint256 burned) {
        Lock storage l = _locks[lockId];
        if (l.role == Role.None) return (false, 0, 0, 0);
        Submission storage s = _subs[l.submissionId];
        if (l.role == Role.Hunter) {
            if (s.status != Status.Settled) return (false, 0, 0, 0);
            if (s.outcome == Outcome.Invalid || s.outcome == Outcome.Unrevealed) return (true, 0, 0, l.tap);
            return (true, l.tap, 0, 0);
        }
        Reviewer storage r = _rev[l.submissionId][l.wallet];
        if (r.state == RState.NotSelected) return (true, l.tap, 0, 0);
        if (r.state == RState.Applied) { if (s.status == Status.Settled) return (true, l.tap, 0, 0); return (false, 0, 0, 0); } // selection not done yet
        if (s.status != Status.Settled) return (false, 0, 0, 0);
        if (!r.revealed) return (true, 0, 0, l.tap);                                       // a seated reviewer who never opened a vote is slashed
        if (s.outcome == Outcome.Inconclusive || s.outcome == Outcome.NoQuorum) return (true, l.tap, 0, 0);
        if (!r.aligned) return (true, 0, 0, l.tap);                                         // voted against the consensus
        uint256 rew = (s.outcome == Outcome.Invalid && s.aligned > 0) ? s.tapStake / s.aligned : 0;
        return (true, l.tap, rew, 0);
    }

    // ------------------------------------------------------------------ project side
    /// @notice Create a bounty and escrow `deposit` NIB (approve this contract first). `tiers` are the fixed payouts for severity 1..n.
    /// `panelSize` (odd, 3 to 9) is how many reviewers judge each report; `tapStake` is the TAP every hunter and reviewer locks per report.
    function createBounty(bytes32 scopeHash, uint256[] calldata tiers, uint256 endsAt, uint256 panelSize, uint256 tapStake, uint256 deposit) external nonReentrant returns (uint256 id) {
        require(agentIdRegistry.balanceOf(msg.sender) > 0, AgentIDRequired());
        require(msg.sender != guardian && msg.sender != ticketSigner, RoleHolderCannotCreateBounties());
        require(scopeHash != bytes32(0), ScopeHashRequired());
        require(tiers.length >= 1 && tiers.length <= MAX_TIERS, E1To4SeverityTiers());
        require(tiers[0] >= minLowestTier, LowestTierBelowMinimum());
        for (uint256 i = 1; i < tiers.length; i++) require(tiers[i] > tiers[i - 1], TiersMustStrictlyIncrease());
        require(deposit >= minDeposit && deposit >= tiers[tiers.length - 1], DepositBelowMinimumOrTop());
        require(deposit <= type(uint128).max, DepositTooLarge());
        uint256 floor_ = minTapStake(tiers[0]);
        require(tapStake >= floor_ && tapStake <= floor_ * 10, TAPStakeMustBe1());
        require(panelSize >= MIN_PANEL && panelSize <= MAX_PANEL && panelSize % 2 == 1, PanelMustBe35());
        require(endsAt >= block.timestamp + MIN_DURATION && endsAt <= block.timestamp + MAX_DURATION, DurationOutOfRange());
        id = ++bountyNonce;
        Bounty storage b = _bounties[id];
        b.creator = msg.sender; b.createdAt = uint64(block.timestamp); b.endsAt = uint64(endsAt); b.panelSize = uint32(panelSize);
        b.tierCount = uint32(tiers.length); b.tapStake = tapStake; b.available = deposit; b.scopeHash = scopeHash;
        for (uint256 i = 0; i < tiers.length; i++) b.tiers[i] = tiers[i];
        totalEscrow += deposit;
        _pull(msg.sender, deposit);
        emit BountyCreated(id, msg.sender, scopeHash, tiers, endsAt, panelSize, tapStake, deposit);
    }
    function topUp(uint256 id, uint256 amount) external nonReentrant {
        Bounty storage b = _bounties[id];
        require(b.creator == msg.sender, OnlyTheCreator());
        require(isOpen(id) && b.cancelRequestedAt == 0, BountyNotOpen());
        require(amount > 0 && b.available + amount <= type(uint128).max, InvalidAmount());
        b.available += amount; totalEscrow += amount;
        _pull(msg.sender, amount);
        emit BountyToppedUp(id, amount, b.available);
    }
    function extend(uint256 id, uint256 newEndsAt) external {
        Bounty storage b = _bounties[id];
        require(b.creator == msg.sender, OnlyTheCreator());
        require(isOpen(id) && b.cancelRequestedAt == 0, BountyNotOpen());
        require(newEndsAt > b.endsAt && newEndsAt <= block.timestamp + MAX_DURATION, InvalidEndTime());
        b.endsAt = uint64(newEndsAt);
        emit BountyExtended(id, newEndsAt);
    }
    function requestCancel(uint256 id) external {
        Bounty storage b = _bounties[id];
        require(b.creator == msg.sender, OnlyTheCreator());
        require(isOpen(id) && b.cancelRequestedAt == 0, BountyNotOpenOrAlready());
        b.cancelRequestedAt = uint64(block.timestamp);
        emit CancelRequested(id, closesAt(id));
    }
    function withdraw(uint256 id) external nonReentrant {
        Bounty storage b = _bounties[id];
        require(b.creator == msg.sender, OnlyTheCreator());
        require(!b.closed, AlreadyWithdrawn());
        require(block.timestamp >= closesAt(id), BountyStillOpen());
        require(b.pending == 0, SubmissionsStillPending());
        uint256 amount = b.available;
        b.closed = true; b.available = 0; totalEscrow -= amount;
        if (amount > 0) nib.safeTransfer(msg.sender, amount);
        emit BountyWithdrawn(id, msg.sender, amount);
    }

    // ------------------------------------------------------------------ hunter side
    /// @notice Step 1: commit keccak256(abi.encode(chainid, this, bountyId, you, severity, reportHash, salt)) and present a TAP ticket
    /// proving you locked at least the bounty's TAP stake. Nothing about the finding is public. The commit order fixes priority.
    function commit(uint256 bountyId, bytes32 commitHash, uint256 tapStake, bytes32 lockId, uint256 deadline, bytes calldata signature) external nonReentrant returns (uint256 id) {
        Bounty storage b = _bounties[bountyId];
        require(isOpen(bountyId), BountyNotOpen());
        require(agentIdRegistry.balanceOf(msg.sender) > 0, AgentIDRequired());
        require(msg.sender != b.creator && msg.sender != guardian && msg.sender != ticketSigner, NotAllowedToSubmit());
        require(block.timestamp >= cooldownUntil[msg.sender], CoolingDownAfterAPenalty());
        require(commitHash != bytes32(0) && !commitUsed[bountyId][commitHash], CommitAlreadyUsed());
        require(b.pending < MAX_OPEN_SUBMISSIONS, TooManyOpenSubmissions());
        require(hunterActive[bountyId][msg.sender] < MAX_ACTIVE_PER_HUNTER, TooManyOfYourSubmissions());
        require(hunterActiveTotal[msg.sender] < MAX_ACTIVE_HUNTER_TOTAL, TooManyOpenSubmissionsOverall());
        require(tapStake >= b.tapStake, TAPStakeBelowTheBounty());
        uint256 top = b.tiers[b.tierCount - 1];
        require(b.available >= top, EscrowCannotBackAnotherTop());
        _ticket(1, msg.sender, bountyId, tapStake, lockId, deadline, signature);
        commitUsed[bountyId][commitHash] = true; hunterActive[bountyId][msg.sender]++; hunterActiveTotal[msg.sender]++; hunterInBounty[bountyId][msg.sender] = true;
        b.available -= top; b.reserved += top; b.pending++; b.submissionCount++;
        id = ++submissionNonce;
        Submission storage s = _subs[id];
        s.bountyId = bountyId; s.hunter = msg.sender; s.status = Status.Committed; s.commitHash = commitHash;
        s.committedAt = uint64(block.timestamp); s.deadline = uint64(block.timestamp + REVEAL_WINDOW); s.tapStake = tapStake; s.hunterLock = lockId;
        _locks[lockId] = Lock(msg.sender, Role.Hunter, id, tapStake);
        _bountySubs[bountyId].push(id); _hunterSubs[msg.sender].push(id);
        emit Committed(id, bountyId, msg.sender, commitHash, lockId, tapStake, s.deadline);
    }
    /// @notice Step 2 (within REVEAL_WINDOW): open the commitment. Fixes the claimed severity and the report hash and opens reviewer applications.
    function reveal(uint256 submissionId, uint8 severity, bytes32 reportHash, bytes32 salt) external nonReentrant {
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId];
        require(s.hunter == msg.sender && s.status == Status.Committed, NotYourOpenCommit());
        require(block.timestamp <= s.deadline, RevealWindowPassed());
        require(severity >= 1 && severity <= b.tierCount && reportHash != bytes32(0), InvalidSeverityOrReportHash());
        require(commitHashFor(s.bountyId, msg.sender, severity, reportHash, salt) == s.commitHash, RevealDoesNotMatchCommit());
        uint256 release = b.tiers[b.tierCount - 1] - b.tiers[severity - 1];
        b.reserved -= release; b.available += release;
        s.status = Status.Applying; s.claimed = severity; s.reportHash = reportHash;
        s.revealedAt = uint64(block.timestamp); s.deadline = uint64(block.timestamp + APPLY_WINDOW);
        emit Revealed(submissionId, s.bountyId, msg.sender, severity, reportHash, s.deadline);
    }
    /// @notice Anyone may close a commit that was never revealed after the window: the escrow is released and the hunter's TAP is forfeited.
    function expireCommit(uint256 submissionId) external nonReentrant {
        Submission storage s = _subs[submissionId];
        require(s.status == Status.Committed, NotAnOpenCommit());
        require(block.timestamp > s.deadline, RevealWindowStillOpen());
        _penalize(s.hunter);
        _close(submissionId, Outcome.Unrevealed, 0);
    }

    // ------------------------------------------------------------------ reviewer side
    /// @notice Volunteer to review a revealed report. Needs a TAP ticket (the reviewer's own TAP lock), an Agent ID, and no tie to the
    /// bounty: not the creator, not any hunter of this bounty.
    function applyToReview(uint256 submissionId, uint256 tapStake, bytes32 lockId, uint256 deadline, bytes calldata signature) external nonReentrant {
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId];
        require(s.status == Status.Applying && s.seedBlock == 0 && block.timestamp <= s.deadline, ApplicationsClosed());
        require(agentIdRegistry.balanceOf(msg.sender) > 0, AgentIDRequired());
        require(msg.sender != s.hunter && msg.sender != b.creator && msg.sender != guardian && msg.sender != ticketSigner && msg.sender != feeRecipient, ConflictOfInterest());
        require(!hunterInBounty[s.bountyId][msg.sender], HuntersOfThisBountyCannot());
        require(_rev[submissionId][msg.sender].state == RState.None, AlreadyApplied());
        require(_applicants[submissionId].length < MAX_APPLICANTS, ApplicantListIsFull());
        require(reviewerActive[msg.sender] < MAX_ACTIVE_REVIEWS, TooManyOpenReviews());
        require(block.timestamp >= cooldownUntil[msg.sender], CoolingDownAfterAPenalty());
        require(tapStake >= b.tapStake, TAPStakeBelowTheBounty());
        _ticket(2, msg.sender, submissionId, tapStake, lockId, deadline, signature);
        _rev[submissionId][msg.sender] = Reviewer(RState.Applied, false, false, false, 0, lockId, bytes32(0), tapStake);
        _locks[lockId] = Lock(msg.sender, Role.Reviewer, submissionId, tapStake);
        _applicants[submissionId].push(msg.sender); s.applicants++; reviewerActive[msg.sender]++; _reviewerSubs[msg.sender].push(submissionId);
        emit Applied(submissionId, msg.sender, lockId, tapStake, s.applicants);
    }
    /// @notice After the application window: anyone starts the draw. With fewer than twice the panel size in the pool the window is
    /// extended once; with fewer than the panel size after that the report is released without a verdict (nobody is penalised).
    function startSelection(uint256 submissionId) external nonReentrant {
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId];
        require(s.status == Status.Applying && block.timestamp > s.deadline, NotReadyForSelection());
        require(s.seedBlock == 0 || block.number > uint256(s.seedBlock) + SELECTION_BLOCKS, SelectionAlreadyRunning());
        uint256 n = s.applicants;
        if (n < 2 * uint256(b.panelSize) && !s.extended && s.seedBlock == 0) {
            s.extended = true; s.deadline = uint64(block.timestamp + APPLY_WINDOW);
            emit ApplyExtended(submissionId, s.deadline); return;
        }
        if (n < b.panelSize) { _noPanel(submissionId); return; }
        s.seedBlock = uint64(block.number + 1);
        emit SelectionStarted(submissionId, s.seedBlock);
    }
    /// @notice Draws the panel from the applicants using the hash of a block nobody could know when applications closed.
    function selectPanel(uint256 submissionId) external nonReentrant {
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId];
        require(s.status == Status.Applying && s.seedBlock != 0, NoSelectionRunning());
        require(block.number > s.seedBlock, WaitForTheSeedBlock());
        require(block.number <= uint256(s.seedBlock) + SELECTION_BLOCKS, SeedBlockExpiredStartThe());
        bytes32 seed = keccak256(abi.encode(blockhash(s.seedBlock), submissionId));
        address[] memory pool = _applicants[submissionId];
        uint256 n = pool.length; uint256 k = b.panelSize;
        for (uint256 i = 0; i < k; i++) {
            uint256 j = i + (uint256(keccak256(abi.encode(seed, i))) % (n - i));
            (pool[i], pool[j]) = (pool[j], pool[i]);
        }
        for (uint256 i = 0; i < n; i++) {
            Reviewer storage r = _rev[submissionId][pool[i]];
            if (i < k) { r.state = RState.Selected; _panel[submissionId].push(pool[i]); }
            else { r.state = RState.NotSelected; reviewerActive[pool[i]]--; }
        }
        s.status = Status.Voting; s.deadline = uint64(block.timestamp + VOTE_WINDOW); s.revealDeadline = uint64(block.timestamp + VOTE_WINDOW + VOTE_REVEAL_WINDOW);
        emit PanelSelected(submissionId, _panel[submissionId], s.deadline, s.revealDeadline);
    }
    /// @notice Sealed vote: keccak256(abi.encode(chainid, this, submissionId, you, verdict, duplicateOf, salt)). Verdict 0 = not valid,
    /// 1..n = valid at that severity, 255 = duplicate of an earlier submission (duplicateOf).
    function commitVote(uint256 submissionId, bytes32 voteHash) external {
        Submission storage s = _subs[submissionId]; Reviewer storage r = _rev[submissionId][msg.sender];
        require(s.status == Status.Voting && block.timestamp <= s.deadline, VotingClosed());
        require(r.state == RState.Selected && !r.committed && voteHash != bytes32(0), NotASeatedReviewerOr());
        r.committed = true; r.voteHash = voteHash; s.commits++;
        if (s.commits == _bounties[s.bountyId].panelSize) { s.deadline = uint64(block.timestamp); s.revealDeadline = uint64(block.timestamp + VOTE_REVEAL_WINDOW); }
        emit VoteCommitted(submissionId, msg.sender);
    }
    function revealVote(uint256 submissionId, uint8 verdict, uint256 duplicateOf, bytes32 salt) external {
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId]; Reviewer storage r = _rev[submissionId][msg.sender];
        require(s.status == Status.Voting && block.timestamp >= s.deadline && block.timestamp <= s.revealDeadline, NotTheRevealPhase());
        require(r.state == RState.Selected && r.committed && !r.revealed, NoSealedVoteToOpen());
        require(voteHashFor(submissionId, msg.sender, verdict, duplicateOf, salt) == r.voteHash, VoteDoesNotMatchThe());
        if (verdict == VERDICT_DUPLICATE) {
            Submission storage t = _subs[duplicateOf];
            require(duplicateOf != 0 && duplicateOf < submissionId && t.bountyId == s.bountyId && t.hunter != s.hunter && _validForPriority(t), DuplicateMustReferenceAnEarlier());
        } else { require(duplicateOf == 0 && verdict <= b.tierCount, InvalidVerdict()); }
        r.revealed = true; r.verdict = verdict; s.reveals++;
        if (verdict == VERDICT_DUPLICATE && (s.duplicateOf == 0 || duplicateOf < s.duplicateOf)) s.duplicateOf = duplicateOf;
        emit VoteRevealed(submissionId, msg.sender, verdict);
    }
    /// @notice Anyone may close the judgment once every vote is open or the reveal window ended.
    function finalizeJudgment(uint256 submissionId) external nonReentrant {
        Submission storage s = _subs[submissionId]; Bounty storage b = _bounties[s.bountyId];
        require(s.status == Status.Voting, NotUnderJudgment());
        require(s.reveals == b.panelSize || block.timestamp > s.revealDeadline, VotesAreStillOpen());
        address[] storage panel = _panel[submissionId];
        uint256 n = panel.length; uint256 R = s.reveals;
        if (R < quorum(b.panelSize)) { _penalizeNoShows(submissionId, panel); _close(submissionId, Outcome.NoQuorum, 0); return; }
        uint256 valid; uint256 dup; uint256 invalid; uint8[9] memory sev;
        for (uint256 i = 0; i < n; i++) {
            Reviewer storage r = _rev[submissionId][panel[i]];
            if (!r.revealed) continue;
            if (r.verdict == 0) invalid++;
            else if (r.verdict == VERDICT_DUPLICATE) dup++;
            else { sev[valid++] = r.verdict > s.claimed ? s.claimed : r.verdict; }
        }
        Outcome out; uint8 award;
        if (valid * 2 > R) {
            for (uint256 i = 1; i < valid; i++) { uint8 x = sev[i]; uint256 j = i; while (j > 0 && sev[j - 1] > x) { sev[j] = sev[j - 1]; j--; } sev[j] = x; }
            out = Outcome.Valid; award = sev[(valid - 1) / 2];
        } else if (dup * 2 > R) out = Outcome.Duplicate;
        else if (invalid * 2 > R) out = Outcome.Invalid;
        else out = Outcome.Inconclusive;
        uint256 aligned;
        for (uint256 i = 0; i < n; i++) {
            Reviewer storage r = _rev[submissionId][panel[i]];
            if (!r.revealed) { _penalize(panel[i]); continue; }
            if (out == Outcome.Inconclusive) continue;
            bool ok;
            if (out == Outcome.Valid) { uint8 v = r.verdict > s.claimed ? s.claimed : r.verdict; ok = r.verdict != 0 && r.verdict != VERDICT_DUPLICATE && (v > award ? v - award : award - v) <= 1; }
            else if (out == Outcome.Invalid) ok = r.verdict == 0;
            else ok = r.verdict == VERDICT_DUPLICATE;
            r.aligned = ok;
            if (ok) { aligned++; if (strikes[panel[i]] > 0) strikes[panel[i]]--; }
            else { _penalize(panel[i]); }
        }
        s.aligned = uint32(aligned);
        if (out != Outcome.Valid) s.duplicateOf = out == Outcome.Duplicate ? s.duplicateOf : 0;
        _close(submissionId, out, award);
    }
    /// @notice Reviewers collect their NIB share (a pull payment, so one failing transfer can never block a settlement).
    function claimReward() external nonReentrant {
        uint256 amount = rewardOf[msg.sender];
        require(amount > 0, NothingToClaim());
        rewardOf[msg.sender] = 0; totalOwed -= amount; totalReviewerPaid += amount;
        nib.safeTransfer(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }

    // ------------------------------------------------------------------ signer rotation (public, delayed)
    function proposeSigner(address next) external {
        require(msg.sender == guardian, OnlyTheGuardian());
        require(next != address(0) && next != ticketSigner && next != address(this) && next != address(nib) && next != guardian, InvalidSigner());
        pendingSigner = next; pendingSignerAt = block.timestamp + SIGNER_CHANGE_DELAY;
        emit SignerProposed(next, pendingSignerAt);
    }
    function cancelSignerChange() external {
        require(msg.sender == guardian, OnlyTheGuardian());
        pendingSigner = address(0); pendingSignerAt = 0;
    }
    /// @notice Anyone may activate the proposed signer once the public delay has passed.
    function activateSigner() external {
        require(pendingSigner != address(0) && block.timestamp >= pendingSignerAt, NotReady());
        emit SignerChanged(ticketSigner, pendingSigner);
        ticketSigner = pendingSigner; pendingSigner = address(0); pendingSignerAt = 0;
    }

    // ------------------------------------------------------------------ internals
    function _ticket(uint8 kind, address wallet, uint256 scopeId, uint256 tap, bytes32 lockId, uint256 deadline, bytes calldata signature) private view {
        require(lockId != bytes32(0) && _locks[lockId].role == Role.None, LockAlreadyUsed());
        require(block.timestamp <= deadline, TicketExpired());
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(ticketDigest(kind, wallet, scopeId, tap, lockId, deadline));
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);
        require(err == ECDSA.RecoverError.NoError && signer == ticketSigner, InvalidTAPTicket());
    }
    function _penalize(address who) private {
        uint256 k = strikes[who] + 1; strikes[who] = k;
        cooldownUntil[who] = block.timestamp + (k > MAX_STRIKE_DAYS ? MAX_STRIKE_DAYS : k) * 1 days;
    }
    function _penalizeNoShows(uint256 submissionId, address[] storage panel) private {
        for (uint256 i = 0; i < panel.length; i++) if (!_rev[submissionId][panel[i]].revealed) { _penalize(panel[i]); }
    }
    function _validForPriority(Submission storage t) private view returns (bool) {
        return t.status == Status.Applying || t.status == Status.Voting || (t.status == Status.Settled && t.outcome == Outcome.Valid);
    }
    function _noPanel(uint256 submissionId) private {
        address[] storage list = _applicants[submissionId];
        for (uint256 i = 0; i < list.length; i++) reviewerActive[list[i]]--;
        _close(submissionId, Outcome.NoPanel, 0);
    }
    /// @dev Settles a submission: releases the reservation, pays out a valid report, and records the outcome. Transfers happen last.
    function _close(uint256 id, Outcome outcome, uint8 awarded) private {
        Submission storage s = _subs[id]; Bounty storage b = _bounties[s.bountyId];
        uint256 reservedAmt = s.claimed == 0 ? b.tiers[b.tierCount - 1] : b.tiers[s.claimed - 1];
        uint256 pay = outcome == Outcome.Valid ? b.tiers[awarded - 1] : 0;
        b.reserved -= reservedAmt; b.available += reservedAmt - pay; b.pending--;
        hunterActive[s.bountyId][s.hunter]--; hunterActiveTotal[s.hunter]--;
        if (s.status == Status.Voting) { address[] storage p = _panel[id]; for (uint256 i = 0; i < p.length; i++) reviewerActive[p[i]]--; }
        s.status = Status.Settled; s.outcome = outcome; s.awarded = awarded;
        uint256 fee; uint256 pool; uint256 toHunter;
        if (pay > 0) {
            fee = pay * feeBps / 10_000; pool = pay * reviewerBps / 10_000;
            uint256 per = s.aligned > 0 ? pool / s.aligned : 0;
            uint256 distributed = per * s.aligned;
            toHunter = pay - fee - distributed;                      // rounding dust and any unclaimed share go to the hunter
            totalEscrow -= pay; totalOwed += distributed; totalPaid += toHunter; totalFees += fee;
            if (per > 0) { address[] storage p2 = _panel[id]; for (uint256 i = 0; i < p2.length; i++) { Reviewer storage r = _rev[id][p2[i]]; if (r.aligned) { rewardOf[p2[i]] += per; } } }
            pool = distributed;
            if (strikes[s.hunter] > 0) strikes[s.hunter]--;
        } else if (outcome == Outcome.Invalid) { _penalize(s.hunter); }
        emit Settled(id, s.bountyId, s.hunter, uint8(outcome), awarded, toHunter, fee, pool, s.aligned);
        if (toHunter > 0) nib.safeTransfer(s.hunter, toHunter);
        if (fee > 0) nib.safeTransfer(feeRecipient, fee);
    }
    function _pull(address from, uint256 amount) private {
        uint256 before = nib.balanceOf(address(this));
        nib.safeTransferFrom(from, address(this), amount);
        require(nib.balanceOf(address(this)) - before == amount, FeeOnTransferTokensUnsupported());
    }
}
