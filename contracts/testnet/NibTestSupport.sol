// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
/// @dev Test funds only. These support contracts cannot be deployed on mainnet.
contract NibTestToken is ERC20, Ownable {
    bool public constant TESTNET_ONLY = true;
    constructor(string memory name_, string memory symbol_, address owner_) ERC20(name_,symbol_) Ownable(owner_) { require(block.chainid==97,"Testnet97 only"); }
    function mint(address wallet,uint256 amount) external onlyOwner { _mint(wallet,amount); }
}
contract NibTestIdentity is Ownable {
    bool public constant TESTNET_ONLY = true;
    mapping(address=>uint256) public balanceOf;
    constructor(address owner_) Ownable(owner_) { require(block.chainid==97,"Testnet97 only"); }
    function setEligible(address wallet,bool eligible) external onlyOwner { balanceOf[wallet]=eligible?1:0; }
}
