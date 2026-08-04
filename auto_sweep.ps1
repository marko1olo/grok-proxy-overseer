$projects = @(
    @{ Name = 'Hecton8'; Path = 'C:\hades\Hecton8'; Build = 'dotnet build .tmp\H8ZeroGCTest\H8ZeroGCTest.csproj' },
    @{ Name = 'Clinic MVP'; Path = 'C:\Clinic_MVP\dental-crm'; Build = 'npm run typecheck' },
    @{ Name = 'GigaHrush2'; Path = 'C:\hades\gigahrush2'; Build = 'cmake --build build-win --config Release && ctest --test-dir build-win -C Release' }
)

foreach ($p in $projects) {
    Write-Host ('=== ' + $p.Name + ' ===')
    cd $p.Path
    $status = git status --porcelain
    if ($status) {
        Write-Host 'Dirty tree found. Changes:'
        Write-Host $status
        Write-Host 'Running compile/test...'
        cmd.exe /c $p.Build
        if ($LASTEXITCODE -eq 0) {
            Write-Host 'Build passed. Committing...'
            git add .
            git commit -m "chore: auto-sweep commit ($($p.Name))"
            git push origin main
        } else {
            Write-Host 'Build FAILED. Not committing.'
        }
    } else {
        Write-Host 'Tree is clean.'
    }
}
