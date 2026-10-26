// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {IERC721} from '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import {MerkleProof} from '@openzeppelin/contracts/utils/cryptography/MerkleProof.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {Ownable2Step} from '@openzeppelin/contracts/access/Ownable2Step.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
/// @notice Funded cumulative rewards, paid only to eligible agent wallets. Roots are operator-produced.
contract TapRewards is Ownable2Step,ReentrancyGuard,Pausable {
 using SafeERC20 for IERC20;
 IERC20 public immutable token;IERC721 public immutable agentIdRegistry;
 uint256 public constant ROOT_DELAY=1 days;
 uint256 public epoch;bytes32 public root;bytes32 public pendingRoot;uint256 public activateAfter;
 mapping(address=>uint256) public claimed;
 event RootProposed(uint256 indexed nextEpoch,bytes32 root,uint256 activateAfter);
 event RootActivated(uint256 indexed epoch,bytes32 root);
 event RootCancelled(bytes32 root);
 event RewardClaimed(address indexed wallet,uint256 indexed epoch,uint256 amount,uint256 cumulative);
 constructor(address token_,address registry_,address owner_) Ownable(owner_){
  require(token_!=address(0)&&registry_!=address(0),'Zero address');token=IERC20(token_);agentIdRegistry=IERC721(registry_);
 }
 function proposeRoot(bytes32 nextRoot) external onlyOwner {require(nextRoot!=bytes32(0)&&pendingRoot==bytes32(0),'Invalid proposal');pendingRoot=nextRoot;activateAfter=block.timestamp+ROOT_DELAY;emit RootProposed(epoch+1,nextRoot,activateAfter);}
 function cancelRoot() external onlyOwner {require(pendingRoot!=bytes32(0),'No proposal');emit RootCancelled(pendingRoot);pendingRoot=bytes32(0);activateAfter=0;}
 function activateRoot() external {require(pendingRoot!=bytes32(0)&&block.timestamp>=activateAfter,'Root not ready');root=pendingRoot;pendingRoot=bytes32(0);activateAfter=0;epoch++;emit RootActivated(epoch,root);}
 function leaf(uint256 epoch_,address wallet,uint256 cumulative) public view returns(bytes32){return keccak256(bytes.concat(keccak256(abi.encode(block.chainid,address(this),epoch_,wallet,cumulative))));}
 function claim(uint256 epoch_,uint256 cumulative,bytes32[] calldata proof) external nonReentrant whenNotPaused {
  require(epoch_==epoch&&root!=bytes32(0),'Inactive epoch');require(agentIdRegistry.balanceOf(msg.sender)>0,'Agent ID required');
  require(MerkleProof.verifyCalldata(proof,root,leaf(epoch_,msg.sender,cumulative)),'Invalid proof');
  uint256 previous=claimed[msg.sender];require(cumulative>previous,'Nothing to claim');uint256 amount=cumulative-previous;claimed[msg.sender]=cumulative;
  token.safeTransfer(msg.sender,amount);emit RewardClaimed(msg.sender,epoch_,amount,cumulative);
 }
 function pause() external onlyOwner {_pause();}function unpause() external onlyOwner {_unpause();}
}
