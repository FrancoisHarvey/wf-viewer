param ([string]$Name)

$clean = $Name.Trim().ToLower() -replace '\s+', '-'
Write-Output "Nom normalisé : $clean"
