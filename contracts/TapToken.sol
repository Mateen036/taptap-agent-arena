// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
/// @notice Fixed-supply BNB Chain memecoin. No taxes, mint authority, or transfer restrictions.
contract TapToken is ERC20 {
 constructor(string memory name_,string memory symbol_,uint256 supply_,address treasury_) ERC20(name_,symbol_){
  require(treasury_!=address(0)&&supply_>0,'Invalid launch parameters');_mint(treasury_,supply_);
 }
}
