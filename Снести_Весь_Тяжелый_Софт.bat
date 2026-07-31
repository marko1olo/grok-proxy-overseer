@echo off
chcp 65001 >nul
echo Удаление Archicad 28...
"C:\Program Files\Graphisoft\Archicad 28\Uninstall.AC\Uninstall.exe" /S
echo Удаление Lumion 12.5...
"C:\Program Files\Lumion 12.5\uninstall000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
echo Удаление VW/ODIS компонентов...
"C:\Program Files\VW_PDUAPI_OE\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
"C:\Program Files\VW_PDUAPI_OS\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
"C:\Program Files\VW_MCD_OE\Uninstaller\VW-MCD MCD-Kernel\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
"C:\Program Files\VW_MCD_OS\Uninstaller\VW-MCD MCD-Kernel\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
"C:\Program Files\VW_MCD_OE\Uninstaller\VW-MCD ODX-Converter\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
"C:\Program Files\VW_MCD_OS\Uninstaller\VW-MCD ODX-Converter\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
"C:\Program Files\VW_MCD_OE\Uninstaller\VW-MCD PDX-Builder\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
echo Удаление драйверов VAG сканеров...
"C:\Program Files (x86)\Volkswagen\VAS6154 Driver\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
"D:\VCDS-RUS\UnInstall.exe" /S
"C:\Program Files (x86)\VCX\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
"C:\Program Files (x86)\Rockway\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
"C:\Users\Admin\AppData\Local\Planoplan\Planoplan Editor\Updater.exe" -uninstall -quiet
echo Удаление главных баз ODIS...
MsiExec.exe /x "{2987D9C0-2AB5-473B-9712-B31F9D80653C}" /quiet /norestart
MsiExec.exe /x "{F7CC0C20-0D30-48EC-A3E5-94C1DAF323A7}" /quiet /norestart
echo Готово! Все программы уничтожены. Ваши файлы и проекты в документах остались нетронутыми.
pause
