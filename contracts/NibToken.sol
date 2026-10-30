// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
/// @notice NIB: fixed 1,000,000,000 supply minted once in the constructor. No owner, mint, burn, tax, blacklist, pause or upgrade path.
/// 80% goes to the airdrop contract and 20% to the liquidity recipient. There is no team or insider allocation.
contract NibToken is ERC20 {
 uint256 public constant TOTAL_SUPPLY=1_000_000_000 ether;
 uint256 public constant AIRDROP_SUPPLY=800_000_000 ether;
 uint256 public constant LIQUIDITY_SUPPLY=200_000_000 ether;
 address public immutable airdrop;address public immutable liquidityRecipient;
 constructor(address airdrop_,address liquidityRecipient_) ERC20('NIB Token','NIB'){
  require(airdrop_!=address(0)&&airdrop_.code.length>0,'Airdrop must be a contract');
  require(liquidityRecipient_!=address(0)&&liquidityRecipient_!=airdrop_,'Invalid liquidity recipient');
  airdrop=airdrop_;liquidityRecipient=liquidityRecipient_;
  _mint(airdrop_,AIRDROP_SUPPLY);_mint(liquidityRecipient_,LIQUIDITY_SUPPLY);
 }
}
