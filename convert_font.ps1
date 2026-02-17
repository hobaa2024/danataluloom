$b = [IO.File]::ReadAllBytes('c:\Users\Danataluloom school\Downloads\Danat\alfont_com_Cairo-Regular.ttf')
$s = [Convert]::ToBase64String($b)
$content = "const GLOBAL_CAIRO_FONT = `"$s`";"
[IO.File]::WriteAllText('c:\Users\Danataluloom school\Downloads\Danat\font-data.js', $content)
