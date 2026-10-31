# Championship Manager 2010 Static Analysis

Date: 2026-10-30

## Scope

- Input: `C:\Users\sekip\Downloads\championship-manager-2010\Championship Manager 2010.iso`
- Analysis target: `Setup\Game\CM2010.exe` inside the mounted ISO.
- The ISO was mounted read-only and dismounted after inspection. The game, launcher, setup program, and crack executable were not run. No ISO payload was copied into the product.
- Analysis was limited to PE metadata, imports, raw strings/sections, and x86 instruction decoding. It is not a source-code recovery or gameplay-equivalence claim.

## Binary identity

- SHA-256: `2b05ae3ba0ad76f48529613b4efa98472bad3b642059f30154d3f424dddc29f2`
- File version: `10.0.0.76253`; product/company metadata: Championship Manager 2010 / Eidos.
- PE32, x86, Windows GUI subsystem, image base `0x400000`, entry RVA `0x3edd670`.
- No CLR/.NET header was present. This is native machine code, so a decompiler can at best infer C-like pseudocode and control flow; it cannot restore original source names, comments, or project files.

## Evidence of the 3D match presentation stack

The executable imports:

- `Direct3DCreate9` from `d3d9.dll`.
- D3DX 9 mesh hierarchy/model loading (`D3DXLoadMeshHierarchyFromXInMemory`, `D3DXLoadMeshFromXInMemory`), frame lookup/destruction, intersection, unprojection, and matrix operations from `d3dx9_33.dll`.
- Win32 timing, threading, file, and window APIs.

The InstallShield file catalog in the ISO identifies asset groups for pitch models and weather/grass variants; player models/textures; person, goal, and flag animations; and match events including pass/kick, tackle, goalkeeper catch/parry, net, and post. The English manual describes a fully animated 3D match engine, support runs/feeds with and without possession, and match footage controls for pausing and following areas of play. These findings confirm the 3D renderer and its event-asset families, but do not reveal the engine's decision formulas.

## Static-analysis obstacle

- The entry point is in a `Sitext` section containing obfuscated-looking control flow, state/stack manipulation, and loops. The executable also has `Stext`, `Sdata`, and `.securom` sections; measured entropy was 8.00 for `Stext`, approximately 7.99 for `Sdata`, and 6.87 for `.securom`.
- `Sdata` begins with a zlib stream (`78 da`) and decompresses successfully from 688,128 on-disk bytes to 2,627,504 bytes, close to its 2,654,128-byte virtual size. Its recovered strings are mostly Windows/system support APIs and protection-related plumbing; no readable match-decision routine was exposed.
- The high-entropy `Stext` section and entry stub indicate that the normal on-disk code is not directly readable as ordinary x86 functions. This is evidence of a transformed/protected runtime layout, not a full identification of its packing or encryption scheme.
- A static scan found no direct code call sites to the imported mesh-loading APIs in the ordinary decoded code ranges. One pointer to `Direct3DCreate9` appeared in a non-code data area. This is consistent with relevant calls residing in transformed/dynamically resolved code, but does not prove which section contains match logic.
- Capstone disassembly was used only for x86 static decoding. Ghidra or another full decompiler is not installed in the analysis environment; no dynamic unpacking/debugging was attempted.

## Result and boundary

We verified the 3D renderer API and the names of match/pitch/player asset families. We did not recover the match simulation source, the 3D movement/animation state machine, or the relationship between simulation decisions and renderer events. The game executable and its assets remain proprietary reference material; TACTICA should reproduce behaviors with original code and independently created or licensed art.

The `SI-Games-Patch-v3.9.68.exe` in the CM0102 workspace is a separate CM0102 patch, not a CM2010 patch. Its self-extracting ZIP contains `update.dat`, `setup.exe`, fonts, and readme files, not source code.

## Next static-analysis step

Identify the protection/packing format and determine whether any match-related code can be decoded from the on-disk executable without launching it. If it cannot, document the limit instead of treating guessed pseudocode as recovered engine behavior.
