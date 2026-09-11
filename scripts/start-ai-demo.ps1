$ErrorActionPreference = 'Stop'
$env:CYCLE_MODE = 'demo'

function Read-SecretToEnvironment([string] $Prompt, [string] $VariableName) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($VariableName, 'Process'))) {
    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
      [Environment]::SetEnvironmentVariable($VariableName, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process')
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
}

Read-SecretToEnvironment '请输入本地教师口令' 'TEACHER_PASSWORD'
Read-SecretToEnvironment '请输入 OpenRouter API Key' 'OPENROUTER_API_KEY'

if (-not $env:OPENROUTER_VISION_MODEL) { $env:OPENROUTER_VISION_MODEL = 'qwen/qwen3.5-9b' }
if (-not $env:OPENROUTER_AGENT_MODEL) { $env:OPENROUTER_AGENT_MODEL = 'qwen/qwen3.5-9b' }
if (-not $env:OPENROUTER_IMAGE_MODEL) { $env:OPENROUTER_IMAGE_MODEL = 'google/gemini-3.1-flash-lite-image' }
if (-not $env:OPENROUTER_DAILY_BUDGET_USD) { $env:OPENROUTER_DAILY_BUDGET_USD = '1.00' }

npm.cmd run dev
