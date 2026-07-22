@echo off
chcp 65001 >nul
echo ========================================
echo   听伴 TingEar - 启动开发模式
echo ========================================
echo.

cd /d "%~dp0"

echo [1] 检查依赖...
if not exist "node_modules" (
    echo node_modules 不存在，正在安装依赖...
    npm install
    if errorlevel 1 (
        echo 依赖安装失败！
        pause
        exit /b 1
    )
)

echo [2] 启动 Electron 开发服务...
echo    npm run dev
echo.
echo ========================================
echo   提示:
echo   - 主窗口关闭 = 最小化到托盘（不会退出）
echo   - 右键托盘图标退出
echo   - 悬浮球在屏幕右下角
echo   - 设置: https://dashscope.console.aliyun.com
echo ========================================
echo.

npm run dev
