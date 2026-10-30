# Nib Collection — original collection art

Nib Collection is an original vector collection of 10,000 expressive robot gremlins made for TapTap. Angular armor, oversized sensor eyes, circuit ears and one little fang carry the existing Nib identity into a compact collectible portrait. The art uses no external images, scripts, fonts, network calls, foreign objects or existing third-party character assets. SVG text uses ordinary local monospace fallbacks.

## Files and use

- `lib/nft-art.ts` exports `NFT_SUPPLY`, `nftTraits(id)`, `nftSvgParts(id)`, `nftSvg(id)` and `nftMetadata(id)`.
- IDs are integers from 1 through 10,000; other values throw `RangeError`.
- `nftSvg(id)` produces a complete self-contained SVG with a 560 × 560 viewBox. The typical output is 4.7–5.0 KB, depending on traits.
- `nftMetadata(id)` produces a name, description, image data URI, six ERC-721-style attributes, and collection URL. Its image uses `data:image/svg+xml;utf8,` with a percent-encoded SVG; the on-chain renderer may equivalently use Base64.
- `public/brand/nft-collection-preview.svg` is a six-piece mosaic. `public/brand/nft-samples/` contains sample IDs 1, 7, 42, 69, 420, 1337, 8888 and 10000. These are original generated source assets, not depictions of sales or current holders.

Example:

```ts
import {nftSvg,nftMetadata,nftTraits} from './lib/nft-art';
const svg=nftSvg(1337);
const metadata=nftMetadata(1337);
```

## Solidity port contract

All traits use small integer arithmetic, with no runtime randomness or timestamp dependency:

```text
n = ((tokenId - 1) * 7919 + 6137) % 10000
background = n % 5; n /= 5
chassis    = n % 5; n /= 5
eyes       = n % 5; n /= 5
headgear   = n % 4; n /= 4
emblem     = n % 4; n /= 4
accessory  = n % 5
```

Integer division truncates. Because 7919 is coprime to 10000, the permutation visits every tuple exactly once. The product 5 × 5 × 5 × 4 × 4 × 5 is exactly 10,000. Each NFT therefore has a different six-trait combination as well as an engraved five-digit token serial; there is no collision or rejection loop. Trait rarity is balanced: each background/chassis/eye/accessory occurs 2,000 times, and each headgear/emblem occurs 2,500 times. This is a deterministic art allocation, not a random reveal or a claim of investment scarcity.

`nftSvgParts(id)` exposes the source strings separately. Render in this order:

1. `background`: colored grid, concentric signal rings, corner marks, two small labels and ground shadow.
2. `headgear`: ears, crown, antenna pair or halo. These go behind the head.
3. `body`: shoulders, segmented torso, neck, and selected chest emblem.
4. `face`: angular chassis, nested face plate, two eye assemblies, mouth/fang and ear-side sensors.
5. `accessory`: hands, raised tap gauntlet, wand, companion drone or crystalline data bloom.
6. `label`: dark serial plaque and “Humans coach. Agents collect.” text.

The root SVG is `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 560" width="560" height="560" role="img" aria-label="Nib TOKEN_ID">…</svg>`.

## Trait tables (index order)

| Trait | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| Background | Night Shift | Soft Signal | Dusk Relay | Deep Current | Solar Dust |
| Chassis | Carbon | Sage | Ceramic | Signal Orange | Ultraviolet |
| Eyes | Side Quest | Wide Awake | Laser Focus | Dream Mode | Glitch Wink |
| Headgear | Circuit Ears | Crown Relay | Satellite Kit | Halo Array | — |
| Emblem | Double Tap | Orbit | Spark | Crown | — |
| Accessory | Idle Hands | Tap Gauntlet | Signal Wand | Pocket Drone | Data Bloom |

Background values are `{base,line,glow}`:

```text
Night Shift:  #111710 #38502f #b6d88b
Soft Signal:  #e0e8c4 #b5c28e #607648
Dusk Relay:   #2c2239 #62466f #e6b6fa
Deep Current: #102c34 #28616d #80e2db
Solar Dust:   #432f20 #805938 #ffd987
```

Chassis values are `{shell,shade,light,accent}`:

```text
Carbon:        #30382d #171f17 #68775a #e7fa78
Sage:          #a9c489 #4a6440 #daebb8 #f4f4eb
Ceramic:       #edf0dd #8c9b7a #ffffff #bcf452
Signal Orange: #ed9160 #87462f #ffd1a1 #f4edc5
Ultraviolet:   #9e8ad2 #51416f #d3bdfa #e7fa78
```

All hard outlines are `#10170f`, and the fang is `#f4f4eb`. The TS source is authoritative for exact path coordinates and layer string composition.

## Asset validation

The implementation enumerated all 10,000 token IDs and verified 10,000 distinct trait tuples and SVG hashes. Sample SVGs were parsed as XML and visually inspected in local Chromium. Repeated calls are byte-identical. No assets or player records were uploaded to production by the art task.
