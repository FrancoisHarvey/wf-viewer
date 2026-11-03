<#
  Exemple fictif: vérifie l'appartenance à des groupes.
#>
param (
    [Parameter(Mandatory=$true)][string]$UserPrincipalName,
    [string]$groupIds,  # liste séparée par des virgules
    [Parameter(Mandatory=$true)][string]$Mode
)

# Variables d'environnement et constantes
$IsSucces = $false
$Message = ""
$config = @{
    Server  = 'example.invalid'
    Port    = 8443
    Retries = 3
    Tags    = @('a', 'b')
}

$template = @"
<html><body>
<h1>Rapport pour $UserPrincipalName</h1>
<p>Mode : $($Mode.ToUpper())</p>
<script>alert('exemple inoffensif')</script>
</body></html>
"@

function Get-ExampleMember {
    param ([string]$Id, [string]$Upn)
    try {
        $result = Get-MgUser -UserId $Upn -ErrorAction Stop
        foreach ($g in ($Id -split ',')) {
            if ($g.Trim() -eq '' -or $g -notmatch '^[0-9a-f-]+$') { continue }
            Write-Host "Groupe $g : $($result.DisplayName)"
        }
        return $true
    }
    catch {
        Write-Error "Erreur: $($_.Exception.Message)"
        return $false
    }
}

$ok = Get-ExampleMember -Id $groupIds -Upn $UserPrincipalName
$retour = [pscustomobject]@{ membreDUnDesGroupes = if ($ok) { 'Oui' } else { 'Non' }; Count = 0x10 }
$retour | ConvertTo-Json
