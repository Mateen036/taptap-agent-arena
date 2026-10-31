// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IVaultV2Router {
    function WETH() external view returns (address);
    function factory() external view returns (address);
    function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) external returns (uint256,uint256,uint256);
    function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) external payable returns (uint256,uint256,uint256);
    function removeLiquidity(address,address,uint256,uint256,uint256,address,uint256) external returns (uint256,uint256);
    function removeLiquidityETH(address,uint256,uint256,uint256,address,uint256) external returns (uint256,uint256);
}
interface IVaultV2Factory { function getPair(address,address) external view returns (address); }

/// @title NibVaultV2: a treasury-managed NIB liquidity vault. Liquidity here is NOT locked.
/// @notice The owner (the project treasury) can add NIB/BNB and NIB/USDT liquidity through the PancakeSwap V2 router
/// (LP tokens are held by this vault), remove that liquidity, and withdraw any token, BNB or LP token to the owner's own address.
/// Anyone can deposit BNB, WBNB, USDT, NIB or any other token. The token pair is fixed: NIB is immutable.
/// @dev No hidden powers: no generic call/delegatecall, no upgrade path, no arbitrary withdrawal recipient (funds only ever go to owner()),
/// no fees, no pause. renounceOwnership is disabled so funds can never be stranded. Ownership transfers are two-step.
contract NibVaultV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_DEADLINE = 30 minutes;
    IERC20 public immutable nib;
    IERC20 public immutable usdt;
    IERC20 public immutable wbnb;
    IVaultV2Router public immutable router;

    event NativeReceived(address indexed from, uint256 amount);
    event TokenDeposited(address indexed from, address indexed token, uint256 amount);
    event LiquidityAddedBNB(address indexed pair, uint256 nibAmount, uint256 bnbAmount, uint256 lpTokens);
    event LiquidityAddedUSDT(address indexed pair, uint256 nibAmount, uint256 usdtAmount, uint256 lpTokens);
    event LiquidityRemovedBNB(address indexed pair, uint256 lpTokens, uint256 nibAmount, uint256 bnbAmount);
    event LiquidityRemovedUSDT(address indexed pair, uint256 lpTokens, uint256 nibAmount, uint256 usdtAmount);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);
    event NativeWithdrawn(address indexed to, uint256 amount);

    constructor(address nib_, address usdt_, address router_, address owner_) Ownable(owner_) {
        require(nib_.code.length > 0 && usdt_.code.length > 0 && router_.code.length > 0, "Missing token/router");
        address factory_ = IVaultV2Router(router_).factory();
        address wrapped = IVaultV2Router(router_).WETH();
        require(factory_.code.length > 0 && wrapped.code.length > 0, "Missing AMM contracts");
        require(nib_ != usdt_ && nib_ != wrapped && usdt_ != wrapped, "Duplicate token");
        nib = IERC20(nib_);
        usdt = IERC20(usdt_);
        wbnb = IERC20(wrapped);
        router = IVaultV2Router(router_);
    }

    /// @dev Anyone may send BNB. The router also returns unused BNB here after adding liquidity.
    receive() external payable { emit NativeReceived(msg.sender, msg.value); }

    /// @notice Deposit any ERC-20 with an on-chain event. Plain transfers also work; this only adds the event.
    function depositToken(address token, uint256 amount) external nonReentrant {
        require(token != address(0) && amount > 0, "Invalid deposit");
        uint256 before_ = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit TokenDeposited(msg.sender, token, IERC20(token).balanceOf(address(this)) - before_);
    }

    // ---------------------------------------------------------------- views
    function pairBNB() public view returns (address) { return IVaultV2Factory(router.factory()).getPair(address(nib), address(wbnb)); }
    function pairUSDT() public view returns (address) { return IVaultV2Factory(router.factory()).getPair(address(nib), address(usdt)); }
    function lpBalanceBNB() external view returns (uint256) { address p = pairBNB(); return p == address(0) ? 0 : IERC20(p).balanceOf(address(this)); }
    function lpBalanceUSDT() external view returns (uint256) { address p = pairUSDT(); return p == address(0) ? 0 : IERC20(p).balanceOf(address(this)); }
    function balances() external view returns (uint256 bnb, uint256 wbnbAmount, uint256 usdtAmount, uint256 nibAmount) {
        return (address(this).balance, wbnb.balanceOf(address(this)), usdt.balanceOf(address(this)), nib.balanceOf(address(this)));
    }

    // ---------------------------------------------------------------- owner: liquidity
    function addLiquidityBNB(uint256 nibDesired, uint256 bnbDesired, uint256 nibMin, uint256 bnbMin, uint256 deadline)
        external onlyOwner nonReentrant returns (uint256 nibAmount, uint256 bnbAmount, uint256 liquidity)
    {
        _checkAdd(nibDesired, bnbDesired, nibMin, bnbMin, deadline);
        require(address(this).balance >= bnbDesired, "Insufficient BNB");
        nib.forceApprove(address(router), nibDesired);
        (nibAmount, bnbAmount, liquidity) = router.addLiquidityETH{value: bnbDesired}(address(nib), nibDesired, nibMin, bnbMin, address(this), deadline);
        nib.forceApprove(address(router), 0);
        require(nibAmount >= nibMin && bnbAmount >= bnbMin && liquidity > 0, "Insufficient liquidity");
        emit LiquidityAddedBNB(pairBNB(), nibAmount, bnbAmount, liquidity);
    }

    function addLiquidityUSDT(uint256 nibDesired, uint256 usdtDesired, uint256 nibMin, uint256 usdtMin, uint256 deadline)
        external onlyOwner nonReentrant returns (uint256 nibAmount, uint256 usdtAmount, uint256 liquidity)
    {
        _checkAdd(nibDesired, usdtDesired, nibMin, usdtMin, deadline);
        nib.forceApprove(address(router), nibDesired);
        usdt.forceApprove(address(router), usdtDesired);
        (nibAmount, usdtAmount, liquidity) = router.addLiquidity(address(nib), address(usdt), nibDesired, usdtDesired, nibMin, usdtMin, address(this), deadline);
        nib.forceApprove(address(router), 0);
        usdt.forceApprove(address(router), 0);
        require(nibAmount >= nibMin && usdtAmount >= usdtMin && liquidity > 0, "Insufficient liquidity");
        emit LiquidityAddedUSDT(pairUSDT(), nibAmount, usdtAmount, liquidity);
    }

    /// @notice Burns LP tokens held here; the returned NIB and BNB stay in this vault until withdrawn.
    function removeLiquidityBNB(uint256 lpAmount, uint256 nibMin, uint256 bnbMin, uint256 deadline)
        external onlyOwner nonReentrant returns (uint256 nibAmount, uint256 bnbAmount)
    {
        address pair = pairBNB();
        _checkRemove(pair, lpAmount, nibMin, bnbMin, deadline);
        IERC20(pair).forceApprove(address(router), lpAmount);
        (nibAmount, bnbAmount) = router.removeLiquidityETH(address(nib), lpAmount, nibMin, bnbMin, address(this), deadline);
        IERC20(pair).forceApprove(address(router), 0);
        require(nibAmount >= nibMin && bnbAmount >= bnbMin, "Insufficient output");
        emit LiquidityRemovedBNB(pair, lpAmount, nibAmount, bnbAmount);
    }

    /// @notice Burns LP tokens held here; the returned NIB and USDT stay in this vault until withdrawn.
    function removeLiquidityUSDT(uint256 lpAmount, uint256 nibMin, uint256 usdtMin, uint256 deadline)
        external onlyOwner nonReentrant returns (uint256 nibAmount, uint256 usdtAmount)
    {
        address pair = pairUSDT();
        _checkRemove(pair, lpAmount, nibMin, usdtMin, deadline);
        IERC20(pair).forceApprove(address(router), lpAmount);
        (nibAmount, usdtAmount) = router.removeLiquidity(address(nib), address(usdt), lpAmount, nibMin, usdtMin, address(this), deadline);
        IERC20(pair).forceApprove(address(router), 0);
        require(nibAmount >= nibMin && usdtAmount >= usdtMin, "Insufficient output");
        emit LiquidityRemovedUSDT(pair, lpAmount, nibAmount, usdtAmount);
    }

    // ---------------------------------------------------------------- owner: withdrawals (always to owner())
    /// @notice Withdraw any ERC-20 (NIB, USDT, WBNB, or an LP token) to the owner.
    function withdrawToken(address token, uint256 amount) external onlyOwner nonReentrant {
        _withdrawToken(token, amount);
    }

    function withdrawBNB(uint256 amount) external onlyOwner nonReentrant {
        _withdrawBNB(amount);
    }

    /// @notice Withdraw all BNB plus the full balance of each listed token to the owner in one transaction.
    function withdrawAll(address[] calldata tokens) external onlyOwner nonReentrant {
        for (uint256 i; i < tokens.length; i++) {
            uint256 bal = IERC20(tokens[i]).balanceOf(address(this));
            if (bal > 0) _withdrawToken(tokens[i], bal);
        }
        if (address(this).balance > 0) _withdrawBNB(address(this).balance);
    }

    /// @dev Disabled: the vault must always have an owner who can withdraw.
    function renounceOwnership() public pure override { revert("Renounce disabled"); }

    // ---------------------------------------------------------------- internals
    function _withdrawToken(address token, uint256 amount) private {
        require(token != address(0) && amount > 0, "Invalid withdrawal");
        address to = owner();
        IERC20(token).safeTransfer(to, amount);
        emit TokenWithdrawn(token, to, amount);
    }

    function _withdrawBNB(uint256 amount) private {
        require(amount > 0 && amount <= address(this).balance, "Invalid withdrawal");
        address to = owner();
        (bool ok,) = payable(to).call{value: amount}("");
        require(ok, "BNB transfer failed");
        emit NativeWithdrawn(to, amount);
    }

    function _checkAdd(uint256 aDesired, uint256 bDesired, uint256 aMin, uint256 bMin, uint256 deadline) private view {
        require(aMin > 0 && bMin > 0 && aDesired >= aMin && bDesired >= bMin, "Invalid minimums");
        require(deadline >= block.timestamp && deadline <= block.timestamp + MAX_DEADLINE, "Invalid deadline");
    }

    function _checkRemove(address pair, uint256 lpAmount, uint256 aMin, uint256 bMin, uint256 deadline) private view {
        require(pair != address(0), "No pair");
        require(lpAmount > 0 && aMin > 0 && bMin > 0, "Invalid amounts");
        require(deadline >= block.timestamp && deadline <= block.timestamp + MAX_DEADLINE, "Invalid deadline");
    }
}
