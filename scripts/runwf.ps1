param(
  [string]$Month = '',
  [string]$Columns = '',
  [string]$KqlFile = ''
)
$rg='rg-poc-lawexport-sea'
$f='c:\Users\kento\.copilot\session-state\90c4ef25-75d0-4aea-b9b1-3d2a4d845d51\files'
$sub='https://management.azure.com/subscriptions/<SUBSCRIPTION_ID>/resourceGroups/rg-poc-lawexport-sea/providers/Microsoft.Web/sites/lawexp-la/hostruntime'
$b="$sub/runtime/webhooks/workflow/api/management"
if ($Month -ne '' -or $Columns -ne '') {
  $args2 = @()
  if ($Month -ne '') { $args2 += "MONTH_OVERRIDE=$Month" }
  if ($Columns -ne '') { $args2 += "COLUMNS=$Columns" }
  az webapp config appsettings set -g $rg -n lawexp-la --settings @args2 -o none
  Start-Sleep 75
}
$before = az rest --method get --url "$b/workflows/monthly-export/runs?api-version=2022-03-01" --query "value[0].name" -o tsv
az rest --method post --url "$b/workflows/monthly-export/triggers/Monthly_JST_5th_0900/run?api-version=2022-03-01" -o none
for ($i=0; $i -lt 30; $i++) {
  Start-Sleep 5
  $id = az rest --method get --url "$b/workflows/monthly-export/runs?api-version=2022-03-01" --query "value[0].name" -o tsv
  if ($id -ne $before) {
    $st = az rest --method get --url "$b/workflows/monthly-export/runs/$($id)?api-version=2022-03-01" --query "properties.status" -o tsv
    if ($st -ne 'Running') { break }
  }
}
"RUN $id STATUS $st"
az rest --method get --url "$b/workflows/monthly-export/runs/$($id)/actions?api-version=2022-03-01" --query "value[?properties.status=='Failed'].{n:name,c:properties.code,e:properties.error.message}" -o json
