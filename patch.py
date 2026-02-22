import sys

with open('main.js', 'r', encoding='utf-8') as f:
    main_code = f.read()

main_code = main_code.replace(
    "const { items, outputPath, resizeToFit } = data;",
    "const { items, outputPath, resizeToFit, metadata } = data;"
)
main_code = main_code.replace(
    "const payload = JSON.stringify({ items: processedItems, outputPath, resizeToFit: !!resizeToFit });",
    "const payload = JSON.stringify({ items: processedItems, outputPath, resizeToFit: !!resizeToFit, metadata });"
)
with open('main.js', 'w', encoding='utf-8') as f:
    f.write(main_code)


with open('installer/setup.iss', 'r', encoding='utf-8') as f:
    iss_code = f.read()

exts = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'gif', 'svg', 'tif', 'tiff']
for ext in exts:
    old_line = f'Root: HKCR; Subkey: \"SystemFileAssociations\\\\.{ext}\\\\shell\\\\CombinePlus\"; ValueType: string; ValueName: \"\"; ValueData: \"Merge with Combine+\"; Flags: uninsdeletekey; Tasks: contextmenu'
    new_line = old_line + f'\nRoot: HKCR; Subkey: \"SystemFileAssociations\\\\.{ext}\\\\shell\\\\CombinePlus\"; ValueType: string; ValueName: \"MultiSelectModel\"; ValueData: \"Player\"; Tasks: contextmenu'
    iss_code = iss_code.replace(old_line, new_line)

with open('installer/setup.iss', 'w', encoding='utf-8') as f:
    f.write(iss_code)
    
print("Patching complete.")
