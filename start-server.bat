@echo off
echo ====================================
echo   تشغيل خادم المنصة المحلي
echo ====================================
echo.
echo سيتم تشغيل الخادم على المنفذ 8000
echo افتح المتصفح على: http://localhost:8000
echo.
echo للإيقاف اضغط Ctrl+C
echo.
echo ====================================
echo.

python -m http.server 8000

pause
