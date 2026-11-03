# PROPOSITION FICTIVE - exemple de correctif
param ([Parameter(Mandatory=$true)][string]$UserPrincipalName, [string]$groupIds, [Parameter(Mandatory=$true)][string]$Mode)
$user = Get-MgUser -UserId $UserPrincipalName
Write-Output $user.Id
