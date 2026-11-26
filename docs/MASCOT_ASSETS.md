# Memento border collie assets

Generated with the built-in `image_gen` tool, not the API/CLI fallback. The final project assets are checked in under `src/renderer/src/assets/mascot/`; runtime loads bundled local images only. No competitor artwork is included.

| Asset | Use |
| --- | --- |
| app-icon.png | Full-resolution source for macOS/Windows/Linux packaging |
| logo.png | 256px startup, favicon, sidebar and Cleanup advisor mark |
| ball.png | 2×2 photographic tennis-ball poses |
| frisbee.png | 2×2 photographic flying-disc poses |
| tug.png | 2×2 photographic rope-tug poses |
| basketball.png | 2×2 photographic basketball poses |

`npm run icon` exports the checked-in source to `build/icon.png` (1024px) and `build/icon.icns` (16–1024px) using sips/iconutil on macOS. Source alpha is preserved; sprite exports are 1024×1024, with 512×512 per frame. `MascotScene` shows reading-order frames through CSS background positions at 1.1–1.5 seconds per loop. The dog is decorative task feedback; it never represents measured scan progress. Users can click or press Enter/Space on the scene to switch games. Reduced motion freezes the first frame, while game switching remains available.

## Prompt set

App icon: “Create the final application icon for Memento, a desktop disk cleanup app. A charming, intelligent black-and-white border collie head, instantly recognizable at tiny dock-icon sizes. Distinct upright ears with one softly tipped ear, a crisp white blaze down forehead and muzzle, expressive warm dark eyes, small nose and a subtle happy expression. Premium tactile three-dimensional illustrated mascot, refined soft fur detail but a bold uncluttered silhouette, front-facing head and upper chest centered in a deep moss-green rounded-square tile, soft directional studio light and restrained realistic depth. The tile occupies about 88% of the square canvas with transparent space around it, suitable for macOS Dock; the dog's ears fit completely inside. No lettering, no words, no badge, no watermark, no extra objects, no container within container. Single square icon, polished final production asset at high resolution.” Requested genuine transparency.

Common sprite direction: “Production animation sprite sheet for a desktop app. Reference image is the identity reference for the SAME happy black-and-white border collie, white forehead blaze, warm brown eyes, one upright ear and one tipped ear. Create ONE square image with EXACTLY FOUR evenly sized square frames arranged in a perfectly aligned 2 by 2 grid, in reading order. No visible grid lines. Each quadrant is a fully transparent studio cutout photograph of the same full-body border collie and its toy. Every pose and the entire toy must stay within its own quadrant, with generous padding and the same dog scale, ground baseline and lighting, no crossing quadrants. Beautiful natural fur, realistic anatomy, energetic humorous playful poses. Neutral soft studio lighting, true transparent background with no scenery, no text, no watermark, no frame borders. Four distinct consecutive phases of a repeating playful action, designed to flip between frames in a small 180px animation.” The app icon was used as the identity reference for each separate generation.

Ball: moss-green tennis ball; play bow watching the ball → paw tap → small forward bound → happy play bow ready to repeat.

Frisbee: terracotta flying disc; watch the hovering disc → spring up → catch the disc mid-leap → land happily with the disc. No human.

Tug: natural cotton braided rope with a knot; planted paws holding rope → lean back and pull → funny sideways head tug → upright and ready to repeat. No human or second dog.

Basketball: miniature orange basketball; sit beside the ball → lift front paw → tap the bouncing ball → joyful hop after it. No court, basket or human.

Final ball framing edit: “Keep the same border collie, toy, photographic detail, four play poses and 2 by 2 equally sized animation frames. Fix framing only: each dog and tennis ball must be completely inside its own square quadrant with at least 12% transparent padding on all four edges. In particular restore the full fluffy tail tip in both top frames so nothing is cropped. All four quadrants have identical canvas dimensions and ground baseline. Produce genuine clean transparency including between paws, with no colored fringes or white studio matte. No grid lines, no text.”

Final frisbee background edit: “Remove the entire white/gray studio background and all white haze, replacing it with genuine fully transparent alpha. Preserve the same border collie identity, natural fur, terracotta flying disc, four distinct action poses and exact evenly aligned 2 by 2 animation grid. Each complete dog and flying disc must fit inside its own quadrant, with at least 10% clear transparent padding around the scene. Nothing may cross between frames. Preserve realistic solid opaque dog and toys; do not make the subject translucent. No text, no grid, no white rectangle, no floor.”

Navigation icons are code-drawn vectors in `agent-ui/NavigationIcon.tsx`, independent of raster image generation. Their shared 24px grid, 1.7px stroke, rounded caps and inherited text color keep small menu icons consistent across themes.
