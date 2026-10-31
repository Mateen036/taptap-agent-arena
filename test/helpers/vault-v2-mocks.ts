// Minimal Uniswap-V2-style mocks (reserves, optimal-amount maths, excess BNB refund, pro-rata removal) used to test NibVaultV2 without a live AMM.
export const vaultV2Mocks=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
contract MockERC20 is ERC20 {constructor(string memory n,string memory s) ERC20(n,s){} function mint(address a,uint256 v) external {_mint(a,v);}}
contract MockWBNB is ERC20 {
 constructor() ERC20("Wrapped BNB","WBNB"){}
 function deposit() external payable {_mint(msg.sender,msg.value);}
 function withdraw(uint256 v) external {_burn(msg.sender,v);(bool ok,)=msg.sender.call{value:v}("");require(ok,"WBNB send");}
}
contract MockLP is ERC20 {address public immutable router;constructor() ERC20("LP","LP"){router=msg.sender;} function mint(address a,uint256 v) external {require(msg.sender==router);_mint(a,v);} function burn(address a,uint256 v) external {require(msg.sender==router);_burn(a,v);}}
contract MockV2Router {
 address public immutable WETH;address public immutable factory;
 constructor(address w){WETH=w;factory=address(this);}
 mapping(address=>mapping(address=>address)) public pairs;
 mapping(address=>uint256) public reserveOf;
 function getPair(address a,address b) external view returns(address){return pairs[a][b];}
 function _pair(address a,address b) internal returns(address p){p=pairs[a][b];if(p==address(0)){p=address(new MockLP());pairs[a][b]=p;pairs[b][a]=p;}}
 function _reserves(address a,address b) internal view returns(uint256 ra,uint256 rb){return(reserveOf[_key(a,b)],reserveOf[_key(b,a)]);}
 function _key(address a,address b) internal pure returns(address){return address(uint160(uint256(keccak256(abi.encode(a,b)))));}
 function _amounts(address a,address b,uint256 ad,uint256 bd,uint256 am,uint256 bm) internal view returns(uint256 x,uint256 y){
  (uint256 ra,uint256 rb)=_reserves(a,b);
  if(ra==0&&rb==0)return(ad,bd);
  uint256 bo=ad*rb/ra;
  if(bo<=bd){require(bo>=bm,"INSUFFICIENT_B_AMOUNT");return(ad,bo);}
  uint256 ao=bd*ra/rb;require(ao<=ad&&ao>=am,"INSUFFICIENT_A_AMOUNT");return(ao,bd);
 }
 function _mintLP(address a,address b,uint256 x,uint256 y,address to) internal returns(uint256 liq){
  address p=_pair(a,b);(uint256 ra,)=_reserves(a,b);uint256 supply=MockLP(p).totalSupply();
  liq=supply==0?Math.sqrt(x*y):x*supply/ra;require(liq>0,"INSUFFICIENT_LIQUIDITY_MINTED");
  reserveOf[_key(a,b)]+=x;reserveOf[_key(b,a)]+=y;MockLP(p).mint(to,liq);
 }
 function addLiquidity(address a,address b,uint256 ad,uint256 bd,uint256 am,uint256 bm,address to,uint256 dl) external returns(uint256 x,uint256 y,uint256 liq){
  require(block.timestamp<=dl,"EXPIRED");(x,y)=_amounts(a,b,ad,bd,am,bm);
  IERC20(a).transferFrom(msg.sender,address(this),x);IERC20(b).transferFrom(msg.sender,address(this),y);liq=_mintLP(a,b,x,y,to);
 }
 function addLiquidityETH(address token,uint256 td,uint256 tm,uint256 em,address to,uint256 dl) external payable returns(uint256 x,uint256 y,uint256 liq){
  require(block.timestamp<=dl,"EXPIRED");(x,y)=_amounts(token,WETH,td,msg.value,tm,em);
  IERC20(token).transferFrom(msg.sender,address(this),x);MockWBNB(WETH).deposit{value:y}();liq=_mintLP(token,WETH,x,y,to);
  if(msg.value>y){(bool ok,)=msg.sender.call{value:msg.value-y}("");require(ok,"refund");}
 }
 function _burnLP(address a,address b,uint256 lp,uint256 am,uint256 bm) internal returns(uint256 x,uint256 y){
  address p=_pair(a,b);(uint256 ra,uint256 rb)=_reserves(a,b);uint256 supply=MockLP(p).totalSupply();
  x=lp*ra/supply;y=lp*rb/supply;require(x>=am,"INSUFFICIENT_A_AMOUNT");require(y>=bm,"INSUFFICIENT_B_AMOUNT");
  MockLP(p).burn(msg.sender,lp);reserveOf[_key(a,b)]-=x;reserveOf[_key(b,a)]-=y;
 }
 function removeLiquidity(address a,address b,uint256 lp,uint256 am,uint256 bm,address to,uint256 dl) external returns(uint256 x,uint256 y){
  require(block.timestamp<=dl,"EXPIRED");(x,y)=_burnLP(a,b,lp,am,bm);IERC20(a).transfer(to,x);IERC20(b).transfer(to,y);
 }
 function removeLiquidityETH(address token,uint256 lp,uint256 tm,uint256 em,address to,uint256 dl) external returns(uint256 x,uint256 y){
  require(block.timestamp<=dl,"EXPIRED");(x,y)=_burnLP(token,WETH,lp,tm,em);IERC20(token).transfer(to,x);MockWBNB(WETH).withdraw(y);(bool ok,)=to.call{value:y}("");require(ok,"ETH send");
 }
 receive() external payable {}
}
contract RejectingOwner {
 bool public reject=true;
 function setReject(bool r) external {reject=r;}
 function call(address t,bytes calldata d) external returns(bytes memory){(bool ok,bytes memory r)=t.call(d);if(!ok){assembly{revert(add(r,32),mload(r))}}return r;}
 function acceptOwnership(address v) external {(bool ok,)=v.call(abi.encodeWithSignature("acceptOwnership()"));require(ok);}
 receive() external payable {require(!reject,"reject");}
}
`;
