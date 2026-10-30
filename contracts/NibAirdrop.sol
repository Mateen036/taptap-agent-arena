// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {Ownable2Step} from '@openzeppelin/contracts/access/Ownable2Step.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {EIP712} from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import {ECDSA} from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
/// @notice Five-season NIB airdrop. Off-chain TAP points convert to NIB through server-signed EIP-712 vouchers.
/// Season 1 is first come, first served with no per-wallet cap and runs until its pool is exhausted (or the owner ends it).
/// The owner can never withdraw NIB: the only exits are claims. Deploy order: airdrop, token(airdrop,liquidity), then setToken(token).
contract NibAirdrop is Ownable2Step,ReentrancyGuard,Pausable,EIP712 {
 using SafeERC20 for IERC20;
 enum Status {Unopened,Open,Ended}
 struct Season {uint256 allocation;uint256 rolledIn;uint256 rolledOut;uint256 paid;uint256 pointsPerNib;Status status;}
 struct Voucher {address wallet;uint256 season;uint256 cumulativePoints;uint256 deadline;bytes32 voucherId;}
 bytes32 public constant VOUCHER_TYPEHASH=keccak256('Voucher(address wallet,uint256 season,uint256 cumulativePoints,uint256 deadline,bytes32 voucherId)');
 uint256 public constant SEASONS=5;
 uint256 public constant TOTAL_AIRDROP=800_000_000 ether;
 uint256 public constant SEASON_1_ALLOCATION=400_000_000 ether;// 50% of the airdrop
 uint256 public constant LATER_SEASONS_POOL=400_000_000 ether;// seasons 2-5 share the other 50%
 uint256 public constant DEFAULT_POINTS_PER_NIB=10;// 10 TAP points = 1 NIB
 uint256 public constant MAX_POINTS_PER_NIB=1_000_000_000_000;
 IERC20 public token;address public signer;uint256 public currentSeason;
 mapping(uint256=>Season) public seasons;
 mapping(uint256=>mapping(address=>uint256)) public convertedPoints;
 event TokenSet(address indexed token);
 event SignerUpdated(address indexed previousSigner,address indexed newSigner);
 event SeasonAllocationSet(uint256 indexed season,uint256 allocation,uint256 season5Allocation);
 event SeasonRateSet(uint256 indexed season,uint256 pointsPerNib);
 event SeasonOpened(uint256 indexed season,uint256 pool,uint256 rolledIn,uint256 pointsPerNib);
 event SeasonEnded(uint256 indexed season,uint256 paid,uint256 rolledOut,bool exhausted);
 event Converted(address indexed wallet,uint256 indexed season,uint256 pointsConverted,uint256 nibPaid,uint256 totalPointsConverted,bool partialFill,bytes32 voucherId);
 constructor(address owner_,address signer_) Ownable(owner_) EIP712('NibAirdrop','1'){
  require(signer_!=address(0),'Zero signer');signer=signer_;emit SignerUpdated(address(0),signer_);
  seasons[1].allocation=SEASON_1_ALLOCATION;
  for(uint256 i=2;i<=4;i++)seasons[i].allocation=LATER_SEASONS_POOL/4;
  seasons[5].allocation=LATER_SEASONS_POOL/4;
  for(uint256 i=1;i<=SEASONS;i++)seasons[i].pointsPerNib=DEFAULT_POINTS_PER_NIB;
 }
 // ---- Owner setup (all of it locked once the season concerned has opened)
 /// @notice One-time link to the NIB token. The airdrop must already hold the full 800M.
 function setToken(address token_) external onlyOwner {
  require(address(token)==address(0)&&token_!=address(0),'Token already set');
  require(IERC20(token_).balanceOf(address(this))>=TOTAL_AIRDROP,'Airdrop is not funded');
  token=IERC20(token_);emit TokenSet(token_);
 }
 function setSigner(address signer_) external onlyOwner {require(signer_!=address(0),'Zero signer');emit SignerUpdated(signer,signer_);signer=signer_;}
 /// @notice Resize seasons 2-4 before they open. Season 5 always receives the remainder so the 400M is never under- or over-allocated.
 function setSeasonAllocation(uint256 season,uint256 allocation) external onlyOwner {
  require(season>=2&&season<=4&&seasons[season].status==Status.Unopened,'Season is locked');
  seasons[season].allocation=allocation;
  uint256 used=seasons[2].allocation+seasons[3].allocation+seasons[4].allocation;
  require(allocation>0&&used<LATER_SEASONS_POOL,'Allocation exceeds the pool');
  seasons[5].allocation=LATER_SEASONS_POOL-used;emit SeasonAllocationSet(season,allocation,seasons[5].allocation);
 }
 function setSeasonRate(uint256 season,uint256 pointsPerNib) external onlyOwner {
  require(season>=1&&season<=SEASONS&&seasons[season].status==Status.Unopened,'Season is locked');
  require(pointsPerNib>=1&&pointsPerNib<=MAX_POINTS_PER_NIB,'Invalid rate');
  seasons[season].pointsPerNib=pointsPerNib;emit SeasonRateSet(season,pointsPerNib);
 }
 /// @notice Opens the next season. The previous one must be exhausted or ended by the owner; its leftover rolls into this one.
 function openNextSeason() external onlyOwner {
  require(address(token)!=address(0),'Token not set');
  uint256 previous=currentSeason;require(previous<SEASONS,'All seasons used');
  uint256 rolled=0;if(previous>0){Season storage p=seasons[previous];require(p.status==Status.Ended,'Previous season still open');rolled=p.rolledOut;}
  uint256 next=previous+1;Season storage s=seasons[next];s.status=Status.Open;s.rolledIn=rolled;currentSeason=next;
  emit SeasonOpened(next,s.allocation+rolled,rolled,s.pointsPerNib);
 }
 /// @notice Owner may close seasons 1-4 early; unpaid NIB rolls into the next season. Season 5 can only end by exhaustion.
 function endSeason() external onlyOwner {
  uint256 n=currentSeason;require(n>=1&&n<SEASONS&&seasons[n].status==Status.Open,'No endable season');
  _end(n,false);
 }
 function pause() external onlyOwner {_pause();}
 function unpause() external onlyOwner {_unpause();}
 /// @dev Renouncing would freeze season progression forever.
 function renounceOwnership() public pure override {revert('Renounce disabled');}
 // ---- Claims
 function claim(Voucher calldata v,bytes calldata signature) external nonReentrant whenNotPaused returns(uint256 points,uint256 nib){
  require(v.wallet!=address(0)&&v.season==currentSeason&&seasons[v.season].status==Status.Open,'Season not open');
  require(block.timestamp<=v.deadline,'Voucher expired');
  require(ECDSA.recover(voucherDigest(v),signature)==signer,'Invalid voucher');
  Season storage s=seasons[v.season];uint256 done=convertedPoints[v.season][v.wallet];
  require(v.cumulativePoints>done,'Nothing to claim');
  (points,nib)=_quote(s,v.cumulativePoints-done);
  require(points>0,'Season exhausted');
  convertedPoints[v.season][v.wallet]=done+points;s.paid+=nib;
  emit Converted(v.wallet,v.season,points,nib,done+points,points<v.cumulativePoints-done,v.voucherId);
  token.safeTransfer(v.wallet,nib);
  if(_affordablePoints(s)==0)_end(v.season,true);
 }
 // ---- Views
 function voucherDigest(Voucher calldata v) public view returns(bytes32){
  return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH,v.wallet,v.season,v.cumulativePoints,v.deadline,v.voucherId)));
 }
 function pool(uint256 season) public view returns(uint256){Season storage s=seasons[season];return s.allocation+s.rolledIn-s.rolledOut;}
 function remaining(uint256 season) public view returns(uint256){Season storage s=seasons[season];return s.allocation+s.rolledIn-s.rolledOut-s.paid;}
 /// @notice What a voucher would pay right now, including partial fills when the pool is short.
 function previewClaim(address wallet,uint256 season,uint256 cumulativePoints) external view returns(uint256 points,uint256 nib){
  Season storage s=seasons[season];uint256 done=convertedPoints[season][wallet];
  if(s.status!=Status.Open||cumulativePoints<=done)return(0,0);
  return _quote(s,cumulativePoints-done);
 }
 // ---- Internals
 function _affordablePoints(Season storage s) private view returns(uint256){return (s.allocation+s.rolledIn-s.rolledOut-s.paid)*s.pointsPerNib/1 ether;}
 function _quote(Season storage s,uint256 owed) private view returns(uint256 points,uint256 nib){
  uint256 affordable=_affordablePoints(s);points=owed<affordable?owed:affordable;nib=points*1 ether/s.pointsPerNib;
 }
 function _end(uint256 n,bool exhausted) private {
  Season storage s=seasons[n];uint256 leftover=s.allocation+s.rolledIn-s.rolledOut-s.paid;
  s.status=Status.Ended;
  if(n<SEASONS){s.rolledOut=leftover;}// season 5 leftover is sub-point dust and stays in the contract
  emit SeasonEnded(n,s.paid,n<SEASONS?leftover:0,exhausted);
 }
}
