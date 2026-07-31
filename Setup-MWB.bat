@echo off
:: Stop Mouse Without Borders
taskkill /f /im MouseWithoutBorders.exe >nul 2>&1
net stop MouseWithoutBordersSvc >nul 2>&1

:: Write Registry settings to HKEY_USERS\.DEFAULT
powershell -Command "Set-ItemProperty -Path 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\MouseWithoutBorders' -Name 'MachineId' -Value 835679197 -Force"
powershell -Command "Set-ItemProperty -Path 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\MouseWithoutBorders' -Name 'MachinePool' -Value 'Shinobu:835679197,OSHINO:315595612,:,:' -Force"
powershell -Command "Set-ItemProperty -Path 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\MouseWithoutBorders' -Name 'MachineMatrix' -Value 'Shinobu,OSHINO,,' -Force"
powershell -Command "Set-ItemProperty -Path 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\MouseWithoutBorders' -Name 'myKey' -Value 'abc123xyz0' -Force"
powershell -Command "Set-ItemProperty -Path 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\MouseWithoutBorders' -Name 'myKeyDate' -Value 'NgAvADEANAAvADIAMAAyADYA' -Force"
powershell -Command "Set-ItemProperty -Path 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\MouseWithoutBorders' -Name 'Name2IP' -Value 'OSHINO 192.168.1.111' -Force"
powershell -Command "Set-ItemProperty -Path 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\MouseWithoutBorders' -Name 'FirstRun' -Value 0 -Force"
powershell -Command "Set-ItemProperty -Path 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\MouseWithoutBorders' -Name 'MatrixOneRow' -Value 1 -Force"
powershell -Command "Set-ItemProperty -Path 'Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\MouseWithoutBorders' -Name 'EasyMouse' -Value 1 -Force"

:: Start Service and App
net start MouseWithoutBordersSvc
start "" "C:\Program Files (x86)\Microsoft Garage\Mouse without Borders\MouseWithoutBorders.exe"

echo Mouse Without Borders configured successfully!
pause
