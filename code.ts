// Layer validation helper
function validateLayer(layer: SceneNode): { isValid: boolean; error?: string } {
    try {
        // Check if layer has valid dimensions
        if (layer.width <= 0 || layer.height <= 0) {
            return { 
                isValid: false, 
                error: `Invalid dimensions: ${layer.width}x${layer.height}` 
            };
        }

        // Check for extremely large layers that might cause memory issues
        if (layer.width > 10000 || layer.height > 10000) {
            return { 
                isValid: false, 
                error: `Layer too large: ${layer.width}x${layer.height}` 
            };
        }

        // Check if layer is visible
        if (!layer.visible) {
            return { 
                isValid: false, 
                error: 'Layer is hidden' 
            };
        }

        // Check for problematic layer types that often cause export issues
        if (layer.type === 'CONNECTOR') {
            return { 
                isValid: false, 
                error: 'Connector elements cannot be exported' 
            };
        }

        // Check if layer has been removed/deleted
        if (layer.removed) {
            return { 
                isValid: false, 
                error: 'Layer has been removed' 
            };
        }

        return { isValid: true };
    } catch (error) {
        return { 
            isValid: false, 
            error: `Validation failed: ${error instanceof Error ? error.message : String(error)}` 
        };
    }
}

// Figma Plugin Interfaces
interface Asset {
  id: string;
  name: string;
  type: SceneNode['type'];
  x: number;
  y: number;
  width: number;
  height: number;
  thumbnail: string;
  hasError?: boolean;
  errorMessage?: string;
}

interface AssetWithData extends Asset {
    data: string; // base64
    size: number; // bytes
}

// NEW: Interface for calculated weights
interface AssetWeight {
    optimized: number;
    unoptimized: number;
}

interface Animation {
    style: string;
    delay: number;
    duration: number;
    easing: string;
    x: number;
    y: number;
    scale: number;
    opacity: number;
    rotation: number;
    intensity?: number;
}

interface AnimationSetting {
    id: string;
    name: string;
    in: Animation;
    mid: Animation;
    out: Animation;
}

interface ImageAsset {
    id: string;
    src: string;
}

interface ZipImageAsset {
    name: string;
    data: string; // Changed to base64 string
}

// Interfaces for WAAPI data structure
interface Keyframe {
    opacity: number;
    transform: string;
}

interface Timing {
    delay: number;
    duration: number;
    easing: string;
    fill: 'forwards';
}

interface AnimationDefinition {
    keyframes: Keyframe[];
    timing: Timing;
}

interface AnimationData {
    selector: string;
    animations: AnimationDefinition[];
    initialStyle: string;
}

// Interface for manifest data
interface ManifestData {
  frameName: string;
  bannerWidth: number;
  bannerHeight: number;
  clickTag: string;
}

// Interface for the entire banner data object
interface BannerData {
    frameName: string;
    bannerWidth: number;
    bannerHeight: number;
    backgroundColor: string;
    clickTag: string;
    loop: boolean;
    totalDuration: number;
    settings: AnimationSetting[];
    assets: Asset[];
    // MODIFIED: No longer storing assetsWithData here.
    exportPreset: string;
}


// Show the plugin UI
figma.showUI(__html__, { width: 850, height: 620 });

let selectionRequestCounter = 0;
// This global variable will hold the most recent selection data for previews.
let currentAssets: Asset[] = [];

// Try to load saved settings and pro status when the plugin starts
(async () => {
    const savedSettings = await figma.clientStorage.getAsync('bannerSettings');
    if (savedSettings) {
        figma.ui.postMessage({ type: 'settings-loaded', settings: savedSettings });
    }
    const proStatus = await figma.clientStorage.getAsync('proStatus');
    if (proStatus) {
        figma.ui.postMessage({ type: 'pro-status-loaded', isPro: true });
    }
})();

// Enhanced HTML/CSS minification function for smaller file sizes
function minifyHtml(html: string): string {
    return html
        // Remove comments
        .replace(/<!--[\s\S]*?-->/g, '')
        // Remove extra whitespace between tags
        .replace(/>\s+</g, '><')
        // Remove leading/trailing whitespace
        .replace(/^\s+|\s+$/gm, '')
        // Remove multiple spaces
        .replace(/\s{2,}/g, ' ')
        // Remove newlines
        .replace(/\n/g, '')
        // Remove unnecessary quotes from attributes
        .replace(/="([a-zA-Z0-9\-_#.]+)"/g, '=$1')
        // Clean up CSS inside style tags
        .replace(/<style>([\s\S]*?)<\/style>/g, (match, css) => {
            const minifiedCss = css
                .replace(/\/\*[\s\S]*?\*\//g, '') // Remove CSS comments
                .replace(/\s*{\s*/g, '{') // Remove spaces around {
                .replace(/;\s*/g, ';') // Remove spaces after ;
                .replace(/\s*}\s*/g, '}') // Remove spaces around }
                .replace(/\s*,\s*/g, ',') // Remove spaces around commas
                .replace(/\s*:\s*/g, ':') // Remove spaces around colons
                .replace(/;}/g, '}') // Remove trailing semicolons
                // Optimize zero values
                .replace(/\b0(px|em|rem|%|pt|pc|in|cm|mm|ex|ch|vw|vh|vmin|vmax|deg|rad|turn|s|ms)\b/g, '0')
                // Compress hex colors
                .replace(/#([0-9a-fA-F])\1([0-9a-fA-F])\2([0-9a-fA-F])\3/g, '#$1$2$3')
                // Remove 0.x decimals
                .replace(/\b0\.(\d+)/g, '.$1')
                .replace(/\s+/g, ' ') // Replace multiple spaces with single space
                .trim();
            return `<style>${minifiedCss}</style>`;
        })
        // Minify inline JavaScript
        .replace(/<script>([\s\S]*?)<\/script>/g, (match, js) => {
            const minifiedJs = js
                .replace(/\/\/.*$/gm, '') // Remove single-line comments
                .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
                .replace(/\s+/g, ' ') // Replace multiple spaces
                .replace(/\s*([{}();,=+\-*\/])\s*/g, '$1') // Remove spaces around operators
                .trim();
            return `<script>${minifiedJs}</script>`;
        });
}

function generateBannerHtml(
    settings: AnimationSetting[], 
    assets: Asset[], 
    imageAssets: ImageAsset[], 
    bannerWidth: number, 
    bannerHeight: number, 
    isPreview: boolean, 
    backgroundColor: string = '#FFFFFF', 
    clickTag: string = 'https://www.google.com', 
    loop: boolean = false, 
    totalDuration: number = 15000,
    exportPreset: string = 'iab'
): string {
    let htmlLayers = '';
    const animationData: AnimationData[] = [];
    const cssAnimations: string[] = [];

    const getTransform = (anim: Animation | null): string => {
        if (!anim) return 'none';
        const scale = anim.scale !== null && anim.scale !== undefined ? anim.scale : 100;
        return `translate(${anim.x || 0}px, ${anim.y || 0}px) scale(${scale / 100}) rotate(${anim.rotation || 0}deg)`;
    };

    settings.forEach(assetSetting => {
        const asset = assets.find(a => a.id === assetSetting.id);
        const image = imageAssets.find(img => img.id === assetSetting.id);
        if (!asset || !image) return;

        const selector = `#asset-${asset.id.replace(/:/g, '\\:')}`;
        htmlLayers += `<div id="asset-${asset.id}" class="asset"><img src="${image.src}" alt="${asset.name}"></div>\n`;
        
        const layerAnimations: AnimationDefinition[] = [];
        const cssLayerAnimations: string[] = [];
        const uniqueId = asset.id.replace(/[^a-zA-Z0-9]/g, '');

        if (assetSetting.in && assetSetting.in.style !== 'none') {
            const anim = assetSetting.in;
            let keyframes: Keyframe[] = [];
            const toOpacity = 1;
            const toTransform = `translate(0px, 0px) scale(1) rotate(0deg)`;

            if (anim.style === 'custom') {
                const fromOpacity = (anim.opacity !== null && anim.opacity !== undefined ? anim.opacity : 0) / 100;
                keyframes = [{ opacity: fromOpacity, transform: getTransform(anim) }, { opacity: toOpacity, transform: toTransform }];
            } else {
                let fromTransform = toTransform;
                switch (anim.style) {
                    case 'fade-in': fromTransform = toTransform; break;
                    case 'slide-in-up': fromTransform = `translateY(30px)`; break;
                    case 'slide-in-down': fromTransform = `translateY(-30px)`; break;
                    case 'slide-in-left': fromTransform = `translateX(30px)`; break;
                    case 'slide-in-right': fromTransform = `translateX(-30px)`; break;
                    case 'zoom-in': fromTransform = `scale(0.8)`; break;
                }
                keyframes = [{ opacity: 0, transform: fromTransform }, { opacity: toOpacity, transform: toTransform }];
            }
            layerAnimations.push({
                keyframes,
                timing: { delay: anim.delay, duration: anim.duration, easing: anim.easing || 'ease', fill: 'forwards' }
            });
            const animName = `anim-in-${uniqueId}`;
            cssAnimations.push(`@keyframes ${animName} { from { opacity: ${keyframes[0].opacity}; transform: ${keyframes[0].transform}; } to { opacity: ${keyframes[1].opacity}; transform: ${keyframes[1].transform}; } }`);
            cssLayerAnimations.push(`${animName} ${anim.duration / 1000}s ${anim.easing || 'ease'} ${anim.delay / 1000}s forwards`);
        }

        if (assetSetting.out && assetSetting.out.style !== 'none') {
            const anim = assetSetting.out;
            let keyframes: Keyframe[] = [];
            const fromOpacity = 1;
            const fromTransform = `translate(0px, 0px) scale(1) rotate(0deg)`;

            if (anim.style === 'custom') {
                const toOpacity = (anim.opacity !== null && anim.opacity !== undefined ? anim.opacity : 0) / 100;
                keyframes = [{ opacity: fromOpacity, transform: fromTransform }, { opacity: toOpacity, transform: getTransform(anim) }];
            } else {
                let toTransform = fromTransform;
                switch (anim.style) {
                    case 'fade-out': toTransform = fromTransform; break;
                    case 'slide-out-up': toTransform = `translateY(-30px)`; break;
                    case 'slide-out-down': toTransform = `translateY(30px)`; break;
                    case 'slide-out-left': toTransform = `translateX(-30px)`; break;
                    case 'slide-out-right': toTransform = `translateX(30px)`; break;
                    case 'zoom-out': toTransform = `scale(0.8)`; break;
                }
                keyframes = [{ opacity: fromOpacity, transform: fromTransform }, { opacity: 0, transform: toTransform }];
            }
            layerAnimations.push({
                keyframes,
                timing: { delay: anim.delay, duration: anim.duration, easing: anim.easing || 'ease', fill: 'forwards' }
            });
            const animName = `anim-out-${uniqueId}`;
            cssAnimations.push(`@keyframes ${animName} { from { opacity: ${keyframes[0].opacity}; transform: ${keyframes[0].transform}; } to { opacity: ${keyframes[1].opacity}; transform: ${keyframes[1].transform}; } }`);
            cssLayerAnimations.push(`${animName} ${anim.duration / 1000}s ${anim.easing || 'ease'} ${anim.delay / 1000}s forwards`);
        }

        // Handle mid animation (attention effects)
        if (assetSetting.mid && assetSetting.mid.style !== 'none') {
            const midAnim = assetSetting.mid;
            const inEndTime = (assetSetting.in && assetSetting.in.delay || 0) + (assetSetting.in && assetSetting.in.duration || 0);
            const outStartTime = assetSetting.out && assetSetting.out.delay || totalDuration;
            const midCustomDelay = midAnim.delay || 0;
            // Mid animation starts at absolute timeline position (midCustomDelay), not relative to in-animation
            const midStartDelay = Math.max(midCustomDelay, inEndTime);
            const midDuration = midAnim.duration || 1000;
            const intensity = midAnim.intensity || 1.05;
            
            // Only add mid animation if there's time between in and out
            if (midStartDelay < outStartTime) {
                let midKeyframes: Keyframe[] = [];
                const midAnimName = `anim-mid-${uniqueId}`;
                
                switch (midAnim.style) {
                    case 'pulse':
                        midKeyframes = [
                            { opacity: 1, transform: 'translate(0px, 0px) scale(1) rotate(0deg)' },
                            { opacity: 1, transform: `translate(0px, 0px) scale(${intensity}) rotate(0deg)` },
                            { opacity: 1, transform: 'translate(0px, 0px) scale(1) rotate(0deg)' }
                        ];
                        cssAnimations.push(`@keyframes ${midAnimName} { 0% { opacity: 1; transform: translate(0px, 0px) scale(1) rotate(0deg); } 50% { opacity: 1; transform: translate(0px, 0px) scale(${intensity}) rotate(0deg); } 100% { opacity: 1; transform: translate(0px, 0px) scale(1) rotate(0deg); } }`);
                        break;
                        
                    case 'shake':
                        const shakeIntensity = Math.max(2, (intensity - 1) * 20); // Increased shake intensity
                        midKeyframes = [
                            { opacity: 1, transform: 'translate(0px, 0px) scale(1) rotate(0deg)' },
                            { opacity: 1, transform: `translate(${shakeIntensity}px, 0px) scale(1) rotate(0deg)` },
                            { opacity: 1, transform: `translate(-${shakeIntensity}px, 0px) scale(1) rotate(0deg)` },
                            { opacity: 1, transform: `translate(${shakeIntensity}px, 0px) scale(1) rotate(0deg)` },
                            { opacity: 1, transform: 'translate(0px, 0px) scale(1) rotate(0deg)' }
                        ];
                        cssAnimations.push(`@keyframes ${midAnimName} { 0% { transform: translate(0px, 0px) scale(1) rotate(0deg); } 20% { transform: translate(${shakeIntensity}px, 0px) scale(1) rotate(0deg); } 40% { transform: translate(-${shakeIntensity}px, 0px) scale(1) rotate(0deg); } 60% { transform: translate(${shakeIntensity}px, 0px) scale(1) rotate(0deg); } 80% { transform: translate(-${shakeIntensity}px, 0px) scale(1) rotate(0deg); } 100% { transform: translate(0px, 0px) scale(1) rotate(0deg); } }`);
                        break;
                }
                
                if (midKeyframes.length > 0) {
                    // Calculate how many times to repeat the animation until out animation starts
                    const availableTime = outStartTime - midStartDelay;
                    const iterationCount = Math.max(1, Math.floor(availableTime / midDuration));
                    
                    layerAnimations.push({
                        keyframes: midKeyframes,
                        timing: { delay: midStartDelay, duration: midDuration, easing: 'ease-in-out', fill: 'forwards' }
                    });
                    
                    // For CSS: use 'infinite' if we want continuous looping until out animation
                    const animationIterations = iterationCount > 10 ? 'infinite' : iterationCount.toString();
                    cssLayerAnimations.push(`${midAnimName} ${midDuration / 1000}s ease-in-out ${midStartDelay / 1000}s ${animationIterations}`);
                }
            }
        }

        animationData.push({
            selector: selector,
            animations: layerAnimations,
            initialStyle: `left: ${asset.x}px; top: ${asset.y}px; width: ${asset.width}px; height: ${asset.height}px; opacity: ${assetSetting.in.style === 'none' ? 1 : 0}; animation: ${cssLayerAnimations.join(', ')};`
        });
    });
    
    let headerScripts = '';
    let clickHandlerScript = `document.getElementById('banner').addEventListener('click', function() { if(clickTag) { window.open(clickTag, '_blank'); } });`;
    let bannerWrapperStart = `<div id="banner" class="banner-container" style="cursor: pointer;">`;
    let bannerWrapperEnd = `</div>`;

    if (!isPreview) {
        switch(exportPreset) {
            case 'sizmek':
                headerScripts = `<script type="text/javascript" src="https://ds.serving-sys.com/BurstingScript/EBLoader.js"></script>`;
                clickHandlerScript = `document.getElementById('banner').addEventListener('click', function() { EB.clickthrough(); });`;
                break;
            case 'xandr':
                bannerWrapperStart = `<a href="\${CLICK_URL}" target="_blank" style="text-decoration: none;"><div id="banner" class="banner-container">`;
                bannerWrapperEnd = `</div></a>`;
                clickHandlerScript = '';
                break;
        }
    }

    const controlScript = isPreview ? `
        <script>
            const allAnimations = [];
            const animationDefs = ${JSON.stringify(animationData)};

            function initializeAnimations() {
                animationDefs.forEach(def => {
                    const el = document.querySelector(def.selector);
                    if (el) {
                        def.animations.forEach(anim => {
                            const animation = el.animate(anim.keyframes, anim.timing);
                            animation.pause();
                            allAnimations.push(animation);
                        });
                    }
                });
                if (window.parent) {
                    window.parent.postMessage({ pluginMessage: { type: 'iframe-ready' } }, '*');
                }
            }

            function setAnimationTime(time) { allAnimations.forEach(anim => anim.currentTime = time); }
            function playAnimations() { allAnimations.forEach(anim => anim.play()); }
            function pauseAnimations() { allAnimations.forEach(anim => anim.pause()); }

            window.addEventListener('message', (event) => {
                const { type, time } = event.data;
                switch(type) {
                    case 'SEEK': setAnimationTime(time); break;
                    case 'PLAY': playAnimations(); break;
                    case 'PAUSE': pauseAnimations(); break;
                }
            });

            document.addEventListener('DOMContentLoaded', initializeAnimations);
        </script>
    ` : '';
    
    const finalCss = `
        .asset { position: absolute; }
        .asset img { display: block; width: 100%; height: auto; }
        ${isPreview ? animationData.map(d => `${d.selector} { ${d.initialStyle.replace(/animation:.*/, '')} }`).join('\n') : animationData.map(d => `${d.selector} { ${d.initialStyle} }`).join('\n')}
        ${isPreview ? '' : cssAnimations.join('\n')}
    `;

    // Optimize CSS by removing duplicate animations and combining similar rules
    const optimizedCss = isPreview ? finalCss : finalCss
        .replace(/\.asset\s*\{\s*position:\s*absolute;\s*\}/g, '.asset{position:absolute}') // Compress asset rules
        .replace(/\.asset\s+img\s*\{\s*display:\s*block;\s*width:\s*100%;\s*height:\s*auto;\s*\}/g, '.asset img{display:block;width:100%;height:auto}') // Compress img rules
        .replace(/\s+/g, ' ') // Remove extra spaces
        .trim();

    const clickTagScript = !isPreview && (exportPreset === 'google-ads' || exportPreset === 'iab') 
        ? `<script type="text/javascript">var clickTag="${clickTag || ''}";</script>` 
        : '';
        
    const loopScript = loop && !isPreview && (exportPreset === 'google-ads' || exportPreset === 'iab') ? `<script>setTimeout(()=>{location.reload()},${totalDuration});</script>` : '';
    
    const noscriptFallback = !isPreview ? `<noscript><img src="backup.png" width="${bannerWidth}" height="${bannerHeight}" alt=""></noscript>` : '';

    let htmlOutput = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="ad.size" content="width=${bannerWidth},height=${bannerHeight}">
    ${clickTagScript}
    ${headerScripts}
    <title>${isPreview ? 'Preview' : 'Banner'}</title><style>
        body { margin: 0; background-color: ${backgroundColor}; }
        .banner-container { width: ${bannerWidth}px; height: ${bannerHeight}px; position: relative; border: 1px solid #ccc; box-sizing: border-box; overflow: hidden; }
        ${optimizedCss}
    </style></head><body>
    ${bannerWrapperStart}
    ${htmlLayers}
    ${bannerWrapperEnd}
    ${noscriptFallback}
    <script>${clickHandlerScript}</script>
    ${controlScript}
    ${loopScript}
    </body></html>`;

    // Minify HTML for production export (not for preview)
    if (!isPreview) {
        htmlOutput = minifyHtml(htmlOutput);
    }

    return htmlOutput;
}

// Helper function to convert hex color to RGB
function hexToRgb(hex: string): RGB {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b };
}

// Helper function to apply animation state to a node at a specific time
function applyAnimationState(node: SceneNode, setting: AnimationSetting, currentTime: number, originalAsset: Asset) {
    const { in: inAnim, mid: midAnim, out: outAnim } = setting;
    
    // Calculate timing
    const inStart = inAnim.delay;
    const inEnd = inStart + inAnim.duration;
    const midStart = midAnim.delay;
    const midEnd = midStart + midAnim.duration;
    const outStart = outAnim.delay;
    const outEnd = outStart + outAnim.duration;
    
    let opacity = 1;
    let x = originalAsset.x;
    let y = originalAsset.y;
    let scaleX = 1;
    let scaleY = 1;
    let rotation = 0;
    
    // Determine which animation phase we're in
    if (currentTime < inStart) {
        // Before animation starts - apply "from" state of in animation
        opacity = inAnim.style === 'fade-in' ? 0 : inAnim.opacity;
        switch (inAnim.style) {
            case 'slide-in-up': y += 30; break;
            case 'slide-in-down': y -= 30; break;
            case 'slide-in-left': x += 30; break;
            case 'slide-in-right': x -= 30; break;
            case 'zoom-in': scaleX = scaleY = 0.8; break;
        }
    } else if (currentTime >= inStart && currentTime <= inEnd) {
        // In animation phase - interpolate
        const progress = (currentTime - inStart) / inAnim.duration;
        const easedProgress = easeInOut(progress);
        
        switch (inAnim.style) {
            case 'fade-in':
                opacity = easedProgress;
                break;
            case 'slide-in-up':
                y = originalAsset.y + (30 * (1 - easedProgress));
                opacity = easedProgress;
                break;
            case 'slide-in-down':
                y = originalAsset.y - (30 * (1 - easedProgress));
                opacity = easedProgress;
                break;
            case 'slide-in-left':
                x = originalAsset.x + (30 * (1 - easedProgress));
                opacity = easedProgress;
                break;
            case 'slide-in-right':
                x = originalAsset.x - (30 * (1 - easedProgress));
                opacity = easedProgress;
                break;
            case 'zoom-in':
                scaleX = scaleY = 0.8 + (0.2 * easedProgress);
                opacity = easedProgress;
                break;
        }
    } else if (currentTime >= midStart && currentTime <= midEnd && midAnim.style !== 'none') {
        // Mid animation phase
        const progress = (currentTime - midStart) / midAnim.duration;
        const intensity = midAnim.intensity || 1.2;
        
        switch (midAnim.style) {
            case 'pulse':
                const pulseScale = 1 + ((intensity - 1) * Math.sin(progress * Math.PI * 4) * 0.5);
                scaleX = scaleY = pulseScale;
                break;
            case 'shake':
                const shakeAmount = (intensity - 1) * 20;
                x += Math.sin(progress * Math.PI * 20) * shakeAmount;
                y += Math.cos(progress * Math.PI * 15) * shakeAmount * 0.5;
                break;
        }
    } else if (currentTime >= outStart && currentTime <= outEnd) {
        // Out animation phase - interpolate to "to" state
        const progress = (currentTime - outStart) / outAnim.duration;
        const easedProgress = easeInOut(progress);
        
        switch (outAnim.style) {
            case 'fade-out':
                opacity = 1 - easedProgress;
                break;
            case 'slide-out-up':
                y = originalAsset.y - (30 * easedProgress);
                opacity = 1 - easedProgress;
                break;
            case 'slide-out-down':
                y = originalAsset.y + (30 * easedProgress);
                opacity = 1 - easedProgress;
                break;
            case 'slide-out-left':
                x = originalAsset.x - (30 * easedProgress);
                opacity = 1 - easedProgress;
                break;
            case 'slide-out-right':
                x = originalAsset.x + (30 * easedProgress);
                opacity = 1 - easedProgress;
                break;
            case 'zoom-out':
                scaleX = scaleY = 1 - (0.2 * easedProgress);
                opacity = 1 - easedProgress;
                break;
        }
    } else if (currentTime > outEnd) {
        // After animation ends - apply final "to" state of out animation
        opacity = outAnim.style === 'none' ? 1 : 0;
        switch (outAnim.style) {
            case 'slide-out-up': y -= 30; break;
            case 'slide-out-down': y += 30; break;
            case 'slide-out-left': x -= 30; break;
            case 'slide-out-right': x += 30; break;
            case 'zoom-out': scaleX = scaleY = 0.8; break;
        }
    }
    
    // Apply the calculated state to the node
    if ('opacity' in node) {
        node.opacity = Math.max(0, Math.min(1, opacity));
    }
    
    if ('x' in node && 'y' in node) {
        node.x = x;
        node.y = y;
    }
    
    if ('rotation' in node) {
        node.rotation = rotation;
    }
    
    // Apply scale by resizing (Figma doesn't have direct scale property)
    if (scaleX !== 1 || scaleY !== 1) {
        if ('resize' in node) {
            const newWidth = node.width * scaleX;
            const newHeight = node.height * scaleY;
            try {
                node.resize(newWidth, newHeight);
            } catch (error) {
                // Ignore resize errors for nodes that can't be resized
            }
        }
    }
}

// Simple easing function
function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function generateManifest(preset: string, data: ManifestData): string | null {
    const { frameName, bannerWidth, bannerHeight, clickTag } = data;
    let manifestObject;

    switch (preset) {
        case 'sizmek':
            manifestObject = {
                "version": "1.0.0",
                "source": "index.html",
                "width": bannerWidth,
                "height": bannerHeight,
                "adParameters": {},
                "clickThrough": {
                    "url": clickTag,
                    "name": "clickTag"
                }
            };
            break;
        
        case 'xandr':
            return null;

        case 'google-ads':
        case 'iab':
        default:
            manifestObject = {
                "version": "1.0.0",
                "title": frameName,
                "description": "A banner created with Hubannero",
                "width": `${bannerWidth}`,
                "height": `${bannerHeight}`,
                "source": "index.html",
                "clicktags": {
                    "clickTag": clickTag
                }
            };
            break;
    }
    return JSON.stringify(manifestObject, null, 2);
}

async function updateSelectionDetails() {
    const localRequestId = ++selectionRequestCounter;
    const selection = figma.currentPage.selection;
    if (selection.length !== 1 || selection[0].type !== 'FRAME') {
        if (localRequestId === selectionRequestCounter) {
            figma.ui.postMessage({ type: 'selection-update', assets: [], frameName: null, bannerWidth: 0, bannerHeight: 0 });
            currentAssets = [];
        }
        return;
    }

    const frame = selection[0];
    let backgroundColor = '#FFFFFF';
    const fills = frame.fills;
    if (fills && Array.isArray(fills) && fills.length > 0 && fills[0].type === 'SOLID') {
        const { r, g, b } = fills[0].color;
        const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0');
        backgroundColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    const children = [...frame.children].filter(child => child.visible && child.width > 0 && child.height > 0);

    if (children.length === 0) {
        if (localRequestId === selectionRequestCounter) {
            figma.ui.postMessage({ type: 'selection-update', assets: [], frameName: frame.name, isEmpty: true, backgroundColor, bannerWidth: frame.width, bannerHeight: frame.height });
            currentAssets = [];
        }
        return;
    }

    // Send initial message with loading state
    if (localRequestId === selectionRequestCounter) {
        figma.ui.postMessage({
            type: 'selection-update',
            assets: [], // Empty initially
            frameName: frame.name,
            backgroundColor,
            bannerWidth: frame.width,
            bannerHeight: frame.height,
            isLoading: true,
            totalLayers: children.length
        });
    }

    const assetDetails: Asset[] = [];
    
    // Process thumbnails asynchronously to prevent blocking
    const processThumbnails = async () => {
        for (let i = 0; i < children.length; i++) {
            // Check if selection has changed
            if (localRequestId !== selectionRequestCounter) {
                return; // Abort if selection changed
            }

            const child = children[i];
            let assetDetail: Asset;
            
            // Robust error handling and validation
            try {
                // Temporarily bypass layer validation for debugging
                // const layerValidation = validateLayer(child);
                // if (!layerValidation.isValid) {
                //     throw new Error(layerValidation.error);
                // }

                // Attempt to export thumbnail
                const thumbnailBytes = await child.exportAsync({ 
                    format: 'PNG', 
                    constraint: { type: 'SCALE', value: 0.5 } 
                });

                // Validate export result
                if (!thumbnailBytes || thumbnailBytes.length === 0) {
                    throw new Error('Export returned empty data');
                }

                assetDetail = {
                    id: child.id, 
                    name: child.name, 
                    type: child.type,
                    x: child.x, 
                    y: child.y, 
                    width: child.width, 
                    height: child.height,
                    thumbnail: `data:image/png;base64,${figma.base64Encode(thumbnailBytes)}`,
                    hasError: false
                };
            } catch (error) {
                // Detailed error logging
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.warn(`Layer "${child.name}" (${child.type}) failed:`, errorMessage);
                
                // Create asset with error state
                assetDetail = {
                    id: child.id, 
                    name: child.name, 
                    type: child.type,
                    x: child.x || 0, 
                    y: child.y || 0, 
                    width: child.width || 0, 
                    height: child.height || 0,
                    thumbnail: '',
                    hasError: true,
                    errorMessage: errorMessage
                };
            }

            assetDetails.push(assetDetail);

            // Send incremental update
            if (localRequestId === selectionRequestCounter) {
                figma.ui.postMessage({
                    type: 'layer-thumbnail-ready',
                    asset: assetDetail,
                    progress: i + 1,
                    total: children.length
                });
            }

            // Yield control periodically to prevent blocking
            if (i % 3 === 0) { // Every 3 thumbnails
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // Send final complete update
        if (localRequestId === selectionRequestCounter) {
            currentAssets = assetDetails;
            figma.ui.postMessage({
                type: 'selection-complete',
                assets: assetDetails,
                frameName: frame.name,
                backgroundColor,
                bannerWidth: frame.width,
                bannerHeight: frame.height
            });
        }
    };

    // Start processing thumbnails
    processThumbnails();
}

updateSelectionDetails();
figma.on('selectionchange', updateSelectionDetails);

figma.ui.onmessage = async (msg) => {
    const { type } = msg;

    if (type === 'save-settings') {
        await figma.clientStorage.setAsync('bannerSettings', msg.settings);
        figma.notify('✅ Settings saved!');
    } else if (type === 'load-settings') {
        const savedSettings = await figma.clientStorage.getAsync('bannerSettings');
        if (savedSettings) {
            figma.ui.postMessage({ type: 'settings-loaded', settings: savedSettings });
            figma.notify('✅ Settings applied!');
        } else {
            figma.notify('No saved settings found.', { error: true });
        }
    } else if (type === 'reset-settings') {
        await figma.clientStorage.setAsync('bannerSettings', undefined);
        await figma.clientStorage.setAsync('proStatus', undefined);
        figma.notify('✅ Settings reset to default.');
    } else if (type === 'unlock-pro') {
        await figma.clientStorage.setAsync('proStatus', true);
        figma.notify('✅ Pro features unlocked!');
    } else if (type === 'generate-preview') {
        const { settings, bannerWidth, bannerHeight, backgroundColor, clickTag, loop, totalDuration } = msg;
        const assets = currentAssets;

        if (!assets || assets.length === 0) {
            figma.ui.postMessage({ type: 'preview-error', error: "No assets to preview." });
            return;
        }

        try {
            const imageAssetsForHtml: ImageAsset[] = [];
            const nodePromises = assets.map((asset: Asset) => figma.getNodeByIdAsync(asset.id));
            const nodesToExport = (await Promise.all(nodePromises)).filter((node): node is SceneNode => node !== null);

            for (const node of nodesToExport) {
                const nodeToExport = node.clone();
                let rotation = 0;
                if ("rotation" in nodeToExport) {
                    rotation = nodeToExport.rotation;
                    nodeToExport.rotation = 0;
                }
                nodeToExport.x = 0;
                nodeToExport.y = 0;
                
                const group = figma.group([nodeToExport], figma.currentPage);
                group.rotation = rotation;
                
                const imageBytes = await group.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
                group.remove();
                
                imageAssetsForHtml.push({ id: node.id, src: `data:image/png;base64,${figma.base64Encode(imageBytes)}` });
            }
            
            const finalHtml = generateBannerHtml(settings, assets, imageAssetsForHtml, bannerWidth, bannerHeight, true, backgroundColor, clickTag, loop, totalDuration);
            figma.ui.postMessage({ type: 'preview-html', html: finalHtml, width: bannerWidth, height: bannerHeight });

        } catch (error) {
            console.error(`Preview generation failed:`, error);
            figma.notify(`Error creating preview. See console for details.`, { error: true });
            figma.ui.postMessage({ type: 'preview-error', error: `An unexpected error occurred during preview.` });
        }
    
    // MODIFIED: This message now ONLY gets the file weights for the queue UI.
    } else if (type === 'get-queue-item-data') {
        try {
            const { bannerData } = msg;
            const nodePromises = (bannerData.assets as Asset[]).map(asset => figma.getNodeByIdAsync(asset.id));
            const nodesToExport = (await Promise.all(nodePromises)).filter((node): node is SceneNode => node !== null);
            
            let totalOptimizedWeight = 0;
            let totalUnoptimizedWeight = 0;

            for (const node of nodesToExport) {
                const nodeToExport = node.clone();
                 if ("rotation" in nodeToExport) nodeToExport.rotation = 0;
                nodeToExport.x = 0;
                nodeToExport.y = 0;
                const group = figma.group([nodeToExport], figma.currentPage);
                
                // Get both sizes
                const optimizedBytes = await group.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
                const unoptimizedBytes = await group.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
                group.remove();

                totalOptimizedWeight += optimizedBytes.length;
                totalUnoptimizedWeight += unoptimizedBytes.length;
            }
            
            figma.ui.postMessage({ 
                type: 'queue-item-data-received', 
                bannerData: bannerData,
                weights: {
                    optimized: totalOptimizedWeight,
                    unoptimized: totalUnoptimizedWeight
                }
            });
        } catch (error) {
            console.error(`Failed to get asset weight data:`, error);
            figma.ui.postMessage({ type: 'generation-error', error: 'Could not process assets for export queue.' });
        }

    // MODIFIED: This message is now the one that does the actual exporting work.
    } else if (type === 'export-single-banner') {
        const { bannerData, index, optimize, exportPreset } = msg;
        const { settings, assets, bannerWidth, bannerHeight, backgroundColor, clickTag, loop, totalDuration, frameName } = bannerData;

        if (!assets || assets.length === 0) {
            const errorMsg = `Banner "${frameName}" has no assets to export.`;
            figma.notify(errorMsg, { error: true });
            figma.ui.postMessage({ type: 'generation-error', error: errorMsg, index });
            return;
        }

        try {
            const imageAssetsForHtml: ImageAsset[] = [];
            const imageAssetsForZip: ZipImageAsset[] = [];
            let backupImageBytes: Uint8Array | null = null;
            
            // Get backup image
            const firstNodeId = assets.length > 0 ? assets[0].id : null;
            if (firstNodeId) {
                const node = await figma.getNodeByIdAsync(firstNodeId);
                if (node && node.parent && node.parent.type === 'FRAME') {
                   backupImageBytes = await node.parent.exportAsync({ format: 'PNG' });
                }
            }

            // Determine export scale based on the final decision from the UI
            // For web banners, 1x is usually sufficient and creates much smaller files
            const exportScale = optimize ? 1 : 1.5; // Reduced from 2x to 1.5x for better balance

            const nodePromises = assets.map((asset: Asset) => figma.getNodeByIdAsync(asset.id));
            const nodesToExport = (await Promise.all(nodePromises)).filter((node): node is SceneNode => node !== null);

            for (let i = 0; i < nodesToExport.length; i++) {
                const node = nodesToExport[i];
                const originalAsset = assets[i];
                const nodeToExport = node.clone();
                let rotation = 0;
                if ("rotation" in nodeToExport) {
                    rotation = nodeToExport.rotation;
                    nodeToExport.rotation = 0;
                }
                nodeToExport.x = 0;
                nodeToExport.y = 0;
                
                const group = figma.group([nodeToExport], figma.currentPage);
                group.rotation = rotation;
                
                // Export using the correct scale and format
                // For optimized exports, try WebP first (smaller files), fallback to PNG
                let imageBytes: Uint8Array;
                let imageName: string;
                
                if (optimize) {
                    try {
                        // Try WebP export for smaller file sizes (if supported)
                        imageBytes = await group.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: exportScale } });
                        imageName = `${originalAsset.name.replace(/[^a-zA-Z0-9]/g, '_')}-${i}.png`;
                    } catch (error) {
                        // Fallback to PNG if WebP fails
                        imageBytes = await group.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: exportScale } });
                        imageName = `${originalAsset.name.replace(/[^a-zA-Z0-9]/g, '_')}-${i}.png`;
                    }
                } else {
                    imageBytes = await group.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: exportScale } });
                    imageName = `${originalAsset.name.replace(/[^a-zA-Z0-9]/g, '_')}-${i}.png`;
                }
                group.remove();

                imageAssetsForHtml.push({ id: originalAsset.id, src: `images/${imageName}` });
                imageAssetsForZip.push({ name: imageName, data: figma.base64Encode(imageBytes) });
            }

            const finalLoop = (exportPreset === 'google-ads' || exportPreset === 'iab') && loop;
            const finalExportHtml = generateBannerHtml(settings, assets, imageAssetsForHtml, bannerWidth, bannerHeight, false, backgroundColor, clickTag, finalLoop, totalDuration, exportPreset);
            const manifest = generateManifest(exportPreset, { frameName, bannerWidth, bannerHeight, clickTag });

            figma.ui.postMessage({ 
                type: 'banner-data-for-zip', 
                html: finalExportHtml, 
                manifest, 
                images: imageAssetsForZip, 
                backupImage: backupImageBytes ? figma.base64Encode(backupImageBytes) : null,
                index: index,
                exportPreset: exportPreset
            });

        } catch (error) {
            console.error(`Banner generation failed for "${frameName}":`, error);
            figma.notify(`Error creating banner "${frameName}". See console.`, { error: true });
            figma.ui.postMessage({ type: 'generation-error', error: `An unexpected error occurred for ${frameName}.`, index });
        }
    
    // NEW: Video Export - Capture Animation Frames
    } else if (type === 'start-video-export') {
        try {
            const { bannerData, format, frameDuration = 33 } = msg; // 33ms = ~30fps
            const { settings, assets, bannerWidth, bannerHeight, backgroundColor, clickTag, loop, totalDuration, frameName } = bannerData;

            if (!assets || assets.length === 0) {
                figma.ui.postMessage({ type: 'video-export-error', error: `Banner "${frameName}" has no assets to export.` });
                return;
            }

            figma.ui.postMessage({ type: 'video-export-progress', stage: 'preparing', progress: 0 });

            // Calculate total frames needed
            const totalFrames = Math.ceil(totalDuration / frameDuration);
            const frames: Uint8Array[] = [];

            // Get nodes to export
            const nodePromises = assets.map((asset: Asset) => figma.getNodeByIdAsync(asset.id));
            const nodesToExport = (await Promise.all(nodePromises)).filter((node): node is SceneNode => node !== null);

            if (nodesToExport.length === 0) {
                figma.ui.postMessage({ type: 'video-export-error', error: 'No valid assets found for export.' });
                return;
            }

            // Create a frame for exporting
            const exportFrame = figma.createFrame();
            exportFrame.name = `${frameName}_video_export`;
            exportFrame.resize(bannerWidth, bannerHeight);
            exportFrame.fills = [{ type: 'SOLID', color: hexToRgb(backgroundColor) }];

            // Clone and position assets in the export frame
            const clonedNodes: SceneNode[] = [];
            for (const node of nodesToExport) {
                const clone = node.clone();
                exportFrame.appendChild(clone);
                clonedNodes.push(clone);
            }

            figma.ui.postMessage({ type: 'video-export-progress', stage: 'capturing', progress: 0, totalFrames });

            // Capture frames
            for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
                const currentTime = frameIndex * frameDuration;
                
                // Apply animation state to each cloned node
                clonedNodes.forEach((clone, index) => {
                    const asset: Asset = assets[index];
                    const setting = settings.find((s: AnimationSetting) => s.id === asset.id);
                    if (setting) {
                        applyAnimationState(clone, setting, currentTime, asset);
                    }
                });

                // Export frame
                const frameBytes = await exportFrame.exportAsync({ 
                    format: 'PNG', 
                    constraint: { type: 'SCALE', value: 2 } // High quality for video
                });
                
                frames.push(frameBytes);
                
                // Update progress
                const progress = ((frameIndex + 1) / totalFrames) * 100;
                figma.ui.postMessage({ 
                    type: 'video-export-progress', 
                    stage: 'capturing', 
                    progress, 
                    frame: frameIndex + 1, 
                    totalFrames 
                });
            }

            // Clean up
            exportFrame.remove();

            // Send frames to UI for upload
            figma.ui.postMessage({ 
                type: 'video-frames-captured', 
                frames: frames.map(frame => Array.from(frame)), // Convert Uint8Array to regular array for postMessage
                format,
                frameDuration,
                totalDuration,
                filename: frameName
            });

        } catch (error) {
            console.error('Video export failed:', error);
            figma.ui.postMessage({ type: 'video-export-error', error: 'Video export failed. See console for details.' });
        }
    }
};