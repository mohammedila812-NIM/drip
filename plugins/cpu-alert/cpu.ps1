# Exec plugin: any language works, just print one JSON object per line. Drips out when CPU stays pinned (max once a minute).
$next = Get-Date
while ($true) {
  $cpu = [int](Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
  if ($cpu -ge 90 -and (Get-Date) -ge $next) {
    $next = (Get-Date).AddSeconds(60)
    @{ push = @{ id = "hot"; pri = 7; icon = "🔥"; title = "CPU $cpu%"; side = "High load"; p = $cpu / 100; color = "#ff453a"; ttl = 6000; peek = 3500 } } | ConvertTo-Json -Compress -Depth 4
  }
  Start-Sleep 5
}
