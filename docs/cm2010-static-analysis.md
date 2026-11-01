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

## Read-only ISO revalidation — 2026-11-01

- Rechecked the supplied ISO directly through its ISO9660 directory records without mounting the image, launching an installer/game executable, or writing extracted files. ISO SHA-256: `99918685612add30d7bfa146e366426c2f0e82be917153282dc8389660fe0469`.
- Confirmed the installation target is `/SETUP/GAME/CM2010.EXE`, 24,747,176 bytes, with the same SHA-256 recorded above. The separate `/CRACK/CM2010.EXE` is 11,223,040 bytes and has `UPX0`/`UPX1` sections; it is not the installation target and was not executed or used for the gameplay analysis.
- Re-read the installation target's PE section table and import directory. The entry RVA `0x3edd670` falls in `Sitext`; `Stext` has measured entropy 8.000 and `Sdata` 7.991. Imports include `d3d9.dll` and `d3dx9_33.dll`. The `.securom` section and strings are present, but this static evidence does not identify a precise protection version or expose the runtime's transformed code.
- This reproduces the earlier protection-boundary finding against the current ISO and distinguishes the packed crack copy from the installed game. No source, movement algorithm, match-event bridge, or renderer state machine was recovered.

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

The read-only offline pass reaches a documented protection boundary: the normal executable imports renderer APIs, but the entry stub and high-entropy transformed sections do not expose the match simulation-to-renderer event boundary. Further code recovery would require an appropriate, legally held decompiler/unpacker and likely runtime analysis; neither was available or attempted here. Treat this static-analysis task as bounded and complete, and do not present guessed pseudocode as recovered gameplay behavior. Continue using the manual's behavior descriptions and independently implemented engine/viewer interfaces as references.
