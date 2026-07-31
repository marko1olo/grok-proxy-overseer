$regPath = "Registry::HKEY_USERS\.DEFAULT\Software\Microsoft\MouseWithoutBorders"

Stop-Process -Name "MouseWithoutBorders" -Force -ErrorAction SilentlyContinue
Stop-Service -Name "MouseWithoutBordersSvc" -Force -ErrorAction SilentlyContinue

if (!(Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}

Set-ItemProperty -Path $regPath -Name "MachineId" -Value 835679197 -Force
Set-ItemProperty -Path $regPath -Name "MachinePool" -Value "Shinobu:835679197,OSHINO:315595612,:,:" -Force
Set-ItemProperty -Path $regPath -Name "MachineMatrix" -Value "Shinobu,OSHINO,," -Force
Set-ItemProperty -Path $regPath -Name "myKey" -Value "abc123xyz0" -Force
Set-ItemProperty -Path $regPath -Name "myKeyDate" -Value "NgAvADEANAAvADIAMAAyADYA" -Force
Set-ItemProperty -Path $regPath -Name "Name2IP" -Value "OSHINO 192.168.1.111" -Force
Set-ItemProperty -Path $regPath -Name "FirstRun" -Value 0 -Force
Set-ItemProperty -Path $regPath -Name "MatrixOneRow" -Value 1 -Force
Set-ItemProperty -Path $regPath -Name "EasyMouse" -Value 1 -Force

Start-Service -Name "MouseWithoutBordersSvc" -ErrorAction SilentlyContinue
Start-Process -FilePath "C:\Program Files (x86)\Microsoft Garage\Mouse without Borders\MouseWithoutBorders.exe"
