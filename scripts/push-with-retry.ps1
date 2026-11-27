param(
  [string]$Repo = 'd:\codebuddy\repair-master',
  [string]$Remote = 'origin',
  [string]$Branch = 'master',
  [int]$MaxRetries = 5,
  [int]$DelaySeconds = 2
)

$gitExe = 'C:\Users\卢\AppData\Local\Programs\Git\cmd\git.exe'
if (-not (Test-Path $gitExe)) { $gitExe = 'git' }

$env:GIT_TERMINAL_PROMPT = '0'
$attemptLogs = New-Object System.Collections.Generic.List[string]

function Write-Line([string]$message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
  Write-Host $line
  $attemptLogs.Add($line)
}

Write-Line "开始推送：$Repo -> $Remote/$Branch，最多 $MaxRetries 次，每次间隔 $DelaySeconds 秒"

for ($i = 1; $i -le $MaxRetries; $i++) {
  Write-Line "第 $i/$MaxRetries 次尝试：git push $Remote $Branch"
  $output = & $gitExe -C $Repo -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 push $Remote $Branch 2>&1
  $exitCode = $LASTEXITCODE
  foreach ($line in $output) { Write-Line "  $line" }

  if ($exitCode -eq 0) {
    Write-Line "推送成功：第 $i 次尝试完成，exit=$exitCode"
    exit 0
  }

  Write-Line "推送失败：第 $i 次尝试 exit=$exitCode"
  if ($i -lt $MaxRetries) {
    Write-Line "等待 $DelaySeconds 秒后重试..."
    Start-Sleep -Seconds $DelaySeconds
  }
}

Write-Line "5 次全部失败，停止重试。最后一次 git push 输出已如上显示。"
exit 1
