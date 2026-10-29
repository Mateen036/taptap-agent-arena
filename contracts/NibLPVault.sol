// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface INibRouter {
    function factory() external view returns (address);
    function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)
        external returns (uint256,uint256,uint256);
}
interface INibFactory { function getPair(address,address) external view returns (address); }

/// @notice Primary mint proceeds can only fund liquidity. LP tokens have no withdrawal path.
/// @dev Owner selects the future token once, after a public two-day delay, and supplies matching tokens.
contract NibLPVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant TOKEN_DELAY = 2 days;
    IERC20 public immutable paymentToken;
    INibRouter public immutable router;
    address public pendingToken;
    uint256 public tokenReadyAt;
    address public liquidityToken;
    uint256 public paymentAdded;
    uint256 public liquidityAdded;
    event TokenProposed(address indexed token, uint256 readyAt);
    event TokenActivated(address indexed token);
    event LiquidityProvided(uint256 tokenAmount, uint256 paymentAmount, uint256 lpTokens);

    constructor(address payment_, address router_, address owner_) Ownable(owner_) {
        require(payment_.code.length > 0 && router_.code.length > 0, "Missing payment/router");
        require(INibRouter(router_).factory().code.length > 0, "Missing AMM factory");
        paymentToken = IERC20(payment_);
        router = INibRouter(router_);
    }
    function proposeToken(address token) external onlyOwner {
        require(liquidityToken == address(0), "Token already permanent");
        require(token.code.length > 0 && token != address(paymentToken) && token != address(this), "Invalid token");
        pendingToken = token;
        tokenReadyAt = block.timestamp + TOKEN_DELAY;
        emit TokenProposed(token, tokenReadyAt);
    }
    function activateToken() external onlyOwner {
        require(liquidityToken == address(0) && pendingToken != address(0), "No pending token");
        require(block.timestamp >= tokenReadyAt, "Token delay");
        liquidityToken = pendingToken;
        pendingToken = address(0);
        emit TokenActivated(liquidityToken);
    }
    function pair() public view returns (address) {
        if (liquidityToken == address(0)) return address(0);
        return INibFactory(router.factory()).getPair(liquidityToken, address(paymentToken));
    }
    function lpTokensLocked() external view returns (uint256) {
        address p = pair();
        return p == address(0) ? 0 : IERC20(p).balanceOf(address(this));
    }
    function addLiquidity(uint256 tokenDesired, uint256 paymentDesired, uint256 tokenMin, uint256 paymentMin, uint256 deadline)
        external onlyOwner nonReentrant returns (uint256 tokenAmount, uint256 paymentAmount, uint256 liquidity)
    {
        require(liquidityToken != address(0), "Token TBA");
        require(tokenMin > 0 && paymentMin > 0 && tokenDesired >= tokenMin && paymentDesired >= paymentMin, "Invalid minimums");
        require(deadline >= block.timestamp && deadline <= block.timestamp + 30 minutes, "Invalid deadline");
        IERC20 token = IERC20(liquidityToken);
        token.forceApprove(address(router), tokenDesired);
        paymentToken.forceApprove(address(router), paymentDesired);
        (tokenAmount, paymentAmount, liquidity) = router.addLiquidity(liquidityToken, address(paymentToken), tokenDesired, paymentDesired, tokenMin, paymentMin, address(this), deadline);
        require(tokenAmount >= tokenMin && paymentAmount >= paymentMin && liquidity > 0, "Insufficient liquidity");
        token.forceApprove(address(router), 0);
        paymentToken.forceApprove(address(router), 0);
        paymentAdded += paymentAmount;
        liquidityAdded += liquidity;
        emit LiquidityProvided(tokenAmount, paymentAmount, liquidity);
    }
    // No generic calls, withdrawals, rescue, LP transfer, or liquidity removal functions.
}
