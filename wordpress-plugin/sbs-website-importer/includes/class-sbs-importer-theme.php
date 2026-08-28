<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SBS_Importer_Theme {
	private const OPTION_CSS  = 'sbs_imported_theme_css';
	private const OPTION_DATA = 'sbs_imported_theme_data';

	public static function register_hooks(): void {
		add_action( 'enqueue_block_assets', array( __CLASS__, 'enqueue' ), 20 );
	}

	public static function save( array $theme ): array {
		$css = self::build_css( $theme );
		SBS_Importer_History::replacing_option( self::OPTION_DATA );
		SBS_Importer_History::replacing_option( self::OPTION_CSS );
		update_option( self::OPTION_DATA, $theme, false );
		update_option( self::OPTION_CSS, $css, false );
		return array( 'css_bytes' => strlen( $css ), 'variables' => substr_count( $css, '--dst--' ) );
	}

	public static function enqueue(): void {
		$css = (string) get_option( self::OPTION_CSS, '' );
		if ( '' === $css ) {
			return;
		}
		self::enqueue_fonts();
		wp_register_style( 'sbs-imported-theme', false, array(), SBS_IMPORTER_VERSION );
		wp_enqueue_style( 'sbs-imported-theme' );
		wp_add_inline_style( 'sbs-imported-theme', $css );
	}

	/**
	 * The typefaces the concept was designed in.
	 *
	 * `build_css` writes `--dst--font-primary: 'Inter', system-ui, sans-serif` and
	 * stops there, which names a font without fetching it. The preview loads these
	 * from Google Fonts, so on the imported page every heading fell back to the
	 * next family in the stack — the typography looked wrong and nothing in the
	 * markup said why.
	 *
	 * Only families the export marked `google: true` are requested, and each name
	 * is checked against a conservative pattern before it goes into a URL.
	 */
	private static function enqueue_fonts(): void {
		$theme = get_option( self::OPTION_DATA, array() );
		$fonts = is_array( $theme ) ? ( $theme['typography']['fonts'] ?? array() ) : array();
		if ( ! is_array( $fonts ) || empty( $fonts ) ) {
			return;
		}
		$families = array();
		foreach ( $fonts as $font ) {
			if ( ! is_array( $font ) || empty( $font['family'] ) || empty( $font['google'] ) ) {
				continue;
			}
			$family = trim( (string) $font['family'] );
			// Letters, digits, spaces and hyphens: enough for every Google family,
			// and not enough to smuggle anything into the query string.
			if ( '' === $family || ! preg_match( '/^[A-Za-z0-9 \-]{1,64}$/', $family ) ) {
				continue;
			}
			$families[ $family ] = true;
		}
		if ( empty( $families ) ) {
			return;
		}
		$query = array();
		foreach ( array_keys( $families ) as $family ) {
			// The weights the DST tokens actually ask for: body, medium, semibold,
			// bold, plus italics for emphasis inside copy.
			$query[] = 'family=' . str_replace( '%20', '+', rawurlencode( $family ) ) . ':ital,wght@0,400;0,500;0,600;0,700;1,400';
		}
		$url = 'https://fonts.googleapis.com/css2?' . implode( '&', $query ) . '&display=swap';
		wp_enqueue_style( 'sbs-imported-fonts', $url, array(), null );
	}

	public static function build_css( array $theme ): string {
		$vars = array();
		foreach ( (array) ( $theme['colors'] ?? array() ) as $key => $value ) {
			self::add_var( $vars, '--dst--' . sanitize_key( (string) $key ), self::reference_or_value( $value, $theme['colors'] ?? array() ) );
		}
		foreach ( (array) ( $theme['layout'] ?? array() ) as $key => $value ) {
			self::add_var( $vars, '--dst--' . sanitize_key( (string) $key ), $value );
		}

		$fonts = $theme['typography']['fonts'] ?? array();
		foreach ( array( 'primary', 'secondary' ) as $role ) {
			if ( ! empty( $fonts[ $role ]['family'] ) ) {
				$fallback = $fonts[ $role ]['fallback'] ?? ( 'primary' === $role ? 'system-ui, sans-serif' : 'Georgia, serif' );
				self::add_var( $vars, '--dst--font-' . $role, "'" . str_replace( "'", '', (string) $fonts[ $role ]['family'] ) . "', " . $fallback );
			}
		}

		$headings = $theme['typography']['headings'] ?? array();
		foreach ( array( 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pretitle', 'subtitle', 'backtitle' ) as $role ) {
			if ( empty( $headings[ $role ] ) || ! is_array( $headings[ $role ] ) ) {
				continue;
			}
			$h = $headings[ $role ];
			if ( isset( $h['min'], $h['max'] ) ) {
				$mid = in_array( $role, array( 'h1', 'h2', 'backtitle' ), true ) ? '6vw' : '3vw';
				$clamp = 'clamp(' . $h['min'] . ',' . $mid . ',' . $h['max'] . ')';
				self::add_var( $vars, '--dst--fs-' . $role, $clamp );
				/*
				 * The same size under the name the pattern library asks for.
				 *
				 * A `c-heading` carries `titleTypography.fontSize` as the literal
				 * string `var(--dst--h2-fs)`, and a `c-list` asks for
				 * `var(--dst--h4-fs)` — role first, then the property. This file
				 * wrote `--dst--fs-h2` only, so those references resolved to
				 * nothing: the block fell back to a preset and a list title
				 * arrived as 22px body text instead of a 33px heading. Both
				 * spellings are written, because the theme's own stylesheet reads
				 * `--dst--fs-h2` and the exported blocks read `--dst--h2-fs`.
				 */
				self::add_var( $vars, '--dst--' . $role . '-fs', $clamp );
				// `fontSizeMobile` is a plain size, not a clamp; the small end of
				// the scale is the size the design uses on a phone.
				self::add_var( $vars, '--dst--' . $role . '-fsM', $h['min'] );
			}
			$map = array( 'ff' => 'ff', 'fw' => 'fw', 'lh' => 'lh', 'ls' => 'ls', 'tt' => 'tt' );
			foreach ( $map as $source => $suffix ) {
				if ( array_key_exists( $source, $h ) ) {
					$value = $h[ $source ];
					if ( 'ff' === $source && in_array( $value, array( 'primary', 'secondary' ), true ) ) {
						$value = 'var(--dst--font-' . $value . ')';
					}
					self::add_var( $vars, '--dst--' . $role . '-' . $suffix, $value );
				}
			}
		}
		$body = $theme['typography']['body'] ?? array();
		if ( isset( $body['base']['lh'] ) ) {
			self::add_var( $vars, '--dst--base-lh', $body['base']['lh'] );
		}
		/*
		 * `sm`/`base`/`lg` under every name the library uses for them. Patterns
		 * ask for `--dst--smaller-text-size`, blocks fall back to `--dst--base-fs`
		 * and the theme's own rules read `--dst--fs-base`; all three are the same
		 * decision, and a card's copy that asked for the first of them was
		 * rendering at the browser default because only the third was written.
		 */
		$scale_aliases = array(
			'sm'   => array( '--dst--fs-sm', '--dst--smaller-text-size', '--dst--small-text-size' ),
			'base' => array( '--dst--fs-base', '--dst--base-fs', '--dst--text-size' ),
			'lg'   => array( '--dst--fs-lg', '--dst--larger-text-size' ),
		);
		foreach ( (array) ( $body['scale'] ?? array() ) as $role => $scale ) {
			if ( ! is_array( $scale ) || ! isset( $scale['min'], $scale['max'] ) ) {
				continue;
			}
			$clamp = 'clamp(' . $scale['min'] . ',1.2vw,' . $scale['max'] . ')';
			$names = $scale_aliases[ $role ] ?? array( '--dst--fs-' . sanitize_key( (string) $role ) );
			foreach ( $names as $name ) {
				self::add_var( $vars, $name, $clamp );
			}
		}

		$buttons = $theme['elements']['buttons'] ?? array();
		$shared = $buttons['shared'] ?? array();
		$shared_map = array( 'ff' => 'ff', 'fs' => 'fs', 'fw' => 'fw', 'lh' => 'lh', 'tt' => 'tt', 'ls' => 'ls', 'radius' => 'br', 'padding' => 'p', 'gap' => 'gap', 'iconSize' => 'icon-size' );
		foreach ( $shared_map as $source => $suffix ) {
			if ( isset( $shared[ $source ] ) ) {
				$value = $shared[ $source ];
				if ( 'ff' === $source && in_array( $value, array( 'primary', 'secondary' ), true ) ) {
					$value = 'var(--dst--font-' . $value . ')';
				}
				self::add_var( $vars, '--dst--btn-' . $suffix, $value );
			}
		}
		$button_roles = array( 'primary' => 'primary', 'primaryInverted' => 'primary-inverted', 'secondary' => 'secondary', 'secondaryInverted' => 'secondary-inverted', 'link' => 'link' );
		$button_map = array( 'c' => 'c', 'bg' => 'bg', 'bdc' => 'bdc', 'bdw' => 'bdw', 'cHover' => 'c-hover', 'bgHover' => 'bg-hover', 'bdcHover' => 'bdc-hover' );
		foreach ( $button_roles as $source_role => $slug ) {
			foreach ( $button_map as $source => $suffix ) {
				if ( isset( $buttons[ $source_role ][ $source ] ) ) {
					self::add_var( $vars, '--dst--btn-' . $slug . '-' . $suffix, self::reference_or_value( $buttons[ $source_role ][ $source ], $theme['colors'] ?? array() ) );
				}
			}
		}

		if ( ! empty( $theme['motion']['duration'] ) ) {
			self::add_var( $vars, '--sbs-motion-duration', $theme['motion']['duration'] );
		}
		if ( ! empty( $theme['motion']['distance'] ) ) {
			self::add_var( $vars, '--sbs-motion-distance', $theme['motion']['distance'] );
		}

		// Mini SBS 2.2.2+ exports the exact resolved design-dial tokens used by
		// the browser preview. Consuming them here prevents WordPress from trying
		// to reconstruct spacing, type, imagery and motion from approximate dial
		// percentages. Unknown keys are deliberately ignored.
		$dial_map = array(
			'sectionGap' => '--dst--desktop-vertical-gap', 'sectionGapSmall' => '--dst--vgap-s', 'sectionGapLarge' => '--dst--vgap-l',
			'headerHeight' => '--dst--header-height', 'containerWidth' => '--dst--default-container-width', 'altContainerWidth' => '--dst--alt-container-width',
			'radius' => '--dst--default-radius', 'h1' => '--dst--fs-h1', 'h2' => '--dst--fs-h2', 'h3' => '--dst--fs-h3', 'h4' => '--dst--fs-h4',
			'cardPadding' => '--sbs-card-pad', 'cardBodyPadding' => '--sbs-card-body-pad', 'gridGap' => '--sbs-grid-gap', 'stackGap' => '--sbs-stack-gap',
			'bodyLineHeight' => '--sbs-body-lh', 'measure' => '--sbs-measure', 'typeScale' => '--sbs-type-scale', 'titleTracking' => '--sbs-title-tracking',
			'titleLineHeight' => '--sbs-title-lh', 'pretitleTracking' => '--sbs-pretitle-ls', 'accentStrength' => '--sbs-accent-strength', 'accentRule' => '--sbs-accent-rule',
			'accentTintAlpha' => '--sbs-accent-tint', 'borderAlpha' => '--sbs-border-alpha', 'borderWidth' => '--sbs-border-width', 'cardShadow' => '--sbs-card-shadow',
			'cardSurfaceMix' => '--sbs-card-surface-mix', 'mediaMinHeight' => '--sbs-media-min', 'mediaSaturate' => '--sbs-media-saturate', 'mediaContrast' => '--sbs-media-contrast',
			'heroMinHeight' => '--sbs-hero-min', 'heroMediaWidth' => '--sbs-hero-media-w', 'heroOverlayAlpha' => '--sbs-hero-overlay-a',
			'motionDuration' => '--sbs-motion-duration', 'motionDistance' => '--sbs-motion-distance', 'motionScale' => '--sbs-motion-scale', 'motionStagger' => '--sbs-motion-stagger',
			'motionEase' => '--sbs-motion-ease', 'hoverLift' => '--sbs-hover-lift', 'mediaHoverZoom' => '--sbs-media-zoom', 'marqueeDuration' => '--sbs-marquee-dur',
			'decorScale' => '--sbs-decor-scale', 'decorOpacity' => '--sbs-decor-opacity',
		);
		foreach ( (array) ( $theme['designDialTokens'] ?? array() ) as $key => $value ) {
			if ( isset( $dial_map[ $key ] ) ) self::add_var( $vars, $dial_map[ $key ], $value );
			// The dials are the resolved truth, and they arrive after the scale
			// above, so the role-first spelling has to be re-pointed at them too
			// or a heading would read a stale size from two blocks earlier.
			if ( in_array( $key, array( 'h1', 'h2', 'h3', 'h4' ), true ) ) {
				self::add_var( $vars, '--dst--' . $key . '-fs', $value );
			}
		}

		if ( ! $vars ) {
			return '';
		}
		$declarations = '';
		foreach ( $vars as $name => $value ) {
			$declarations .= $name . ':' . $value . ';';
		}
		$rules = "\n" .
			/*
			 * A section is a band, not a column.
			 *
			 * The theme renders the page into `<main class="is-layout-constrained">`,
			 * and WordPress caps every direct child of that at
			 * `--wp--style--global--content-size` — `var(--blog-width,850px)` in this
			 * theme. `.dst-wrapper` and `.container-fluid` set `max-width:100%` and
			 * escape it; a section rooted in anything else does not, so it arrived as
			 * an 850px column centred in a 1440px page while the preview showed it
			 * full width.
			 *
			 * Only Digital Silk blocks at the top level of a constrained root are
			 * released, and only those carrying no container class of their own — so
			 * a band that asked for `container` or `container-alt` keeps exactly the
			 * measure it asked for, and prose, embeds and every core block the theme
			 * lays out keep the reading measure they were given.
			 *
			 * Three selectors because the block package is not consistent about the
			 * wrapper: `dst-wrapper` renders `wp-block-ds-blocks-dst-wrapper`, and
			 * `dst-columns` renders `ds-columns` and no `wp-block-` class at all, so
			 * matching on the WordPress wrapper alone missed exactly the block that
			 * was being squeezed.
			 *
			 * The exclusions are the container classes this theme actually gives a
			 * width to on the front end, measured against the live stylesheet rather
			 * than taken from the editor's list. `container-wide`, `container-left`
			 * and `container-right` are not among them — they are styled only under
			 * `.editor-styles-wrapper` — so a band wearing one is released too, which
			 * is the whole reason it needed releasing.
			 */
			".is-layout-constrained > [class*=\"wp-block-ds-blocks-\"]:not(.container):not(.container-fluid):not(.container-alt):not(.container-alt-2):not(.container-alt-3):not(.container-alt-4):not(.container-alt-5):not(.container-custom):not(.alignleft):not(.alignright),.is-layout-constrained > [class^=\"ds-\"]:not(.container):not(.container-fluid):not(.container-alt):not(.container-alt-2):not(.container-alt-3):not(.container-alt-4):not(.container-alt-5):not(.container-custom),.is-layout-constrained > [class^=\"dst-\"]:not(.container):not(.container-fluid):not(.container-alt):not(.container-alt-2):not(.container-alt-3):not(.container-alt-4):not(.container-alt-5):not(.container-custom){max-width:none;margin-left:0;margin-right:0}\n" .
			self::scoped( '', 'line-height:var(--sbs-body-lh,inherit)' ) .
			self::scoped( '.sbs-rich-text', 'max-width:var(--sbs-measure,none)' ) .
			self::scoped( '.c-heading__sub,.c-heading__description p', 'max-width:var(--sbs-measure,none)' ) .
			/*
			 * The dial is the fallback, not the answer.
			 *
			 * These used to set letter-spacing and line-height outright, which beat
			 * the `var(--dst--title-ls, …)` the theme reads and therefore beat the
			 * block's own inline value — so a heading whose spacing had been
			 * measured from the preview was overwritten by the dial a moment
			 * later. Asking for the block's variable first puts them back in the
			 * right order: what the block was told, then the dial, then inherit.
			 */
			self::scoped( '.c-heading__title', 'letter-spacing:var(--dst--title-ls,var(--sbs-title-tracking,inherit));line-height:var(--dst--title-lh,var(--sbs-title-lh,inherit));text-wrap:balance' ) .
			self::scoped( '.c-heading__pre', 'letter-spacing:var(--dst--pretitle-ls,var(--sbs-pretitle-ls,inherit))' ) .
			/*
			 * A button's leading, which the theme fixes at 1.2 on the inner span.
			 *
			 * There is no `--dst--btn-lh` in the block package and no rule on
			 * `.c-btn` at all, so setting it on the button alone changed nothing:
			 * `.c-btn__txt{line-height:1.2}` names the element that holds the words
			 * and inheritance never reaches it. Both are set, so a design drawn on
			 * a tighter button arrives on one.
			 */
			self::scoped( '.c-btn,.c-btn__txt', 'line-height:var(--dst--btn-lh,inherit)' ) .
			/*
			 * The accented phrase inside a headline.
			 *
			 * The export writes the preview's own markup into the title, because
			 * `acf_title` runs it through `wp_kses_post` and a span with a class is
			 * the only way the block can carry emphasis. These are the styles that
			 * markup expects; without them the phrase arrives correctly marked and
			 * completely unstyled.
			 */
			self::scoped( '.dst-accent', 'color:inherit' ) .
			self::scoped( '.dst-accent em,.c-heading__title em', 'font-style:italic' ) .
			self::scoped( '.dst-accent strong,.c-heading__title strong', 'font-weight:800' ) .
			// The preview reveals the highlight on scroll; a page can be printed,
			// screenshotted or read with motion off, so here it is simply drawn.
			self::scoped( '.dst-accent--highlight', 'background-image:linear-gradient(var(--dst-hl,var(--dst--primary-color2)),var(--dst-hl,var(--dst--primary-color2)));background-repeat:no-repeat;background-position:0 88%;background-size:100% 34%' ) .
			self::scoped( '.c-block', 'box-shadow:var(--sbs-card-shadow,none);border-width:var(--sbs-border-width,0);transition-duration:var(--sbs-motion-duration,0s);transition-timing-function:var(--sbs-motion-ease,ease)' ) .
			self::scoped( '.ph,.c-block__media', 'border-radius:var(--dst--default-radius,0);overflow:hidden' ) .
			self::scoped( '.ph img,.c-bg__layer', 'filter:saturate(var(--sbs-media-saturate,1)) contrast(var(--sbs-media-contrast,1));transition:transform var(--sbs-motion-duration,0s) var(--sbs-motion-ease,ease)' ) .
			"@media(prefers-reduced-motion:reduce){" . self::scoped( '', '--sbs-motion-duration:0s;--sbs-motion-distance:0px;--sbs-motion-scale:1;--sbs-motion-stagger:0ms;--sbs-hover-lift:0px;--sbs-media-zoom:1' ) . "}\n" .
			/*
			 * The scrim under a card that uses its picture as its background.
			 *
			 * The preview draws one — `.c-block__scrim`, a dark gradient — and the
			 * card's title and copy are painted white to sit on it. The block
			 * package has no element and no attribute for it: `dst-cards/render.php`
			 * never reads an overlay, `dst-card-item/render.php` never reads one,
			 * and `c-block__scrim` appears nowhere in the theme. So an imported
			 * media-background card put white type straight onto the photograph.
			 *
			 * The theme does reserve the layer — `.media-bg .dst-card` declares
			 * `--zIndex-overlay:1` between the picture at 0 and the body at 2 — so
			 * this paints into the slot the theme left for it, and nothing else.
			 */
			self::scoped( '.media-bg .dst-card', 'position:relative;isolation:isolate' ) .
			self::scoped( '.media-bg .dst-card::after', 'content:"";position:absolute;inset:0;z-index:var(--zIndex-overlay,1);pointer-events:none;border-radius:inherit;background:var(--sbs-card-scrim,linear-gradient(180deg,rgba(7,28,42,.02),rgba(7,28,42,.92)))' );
			/*
			 * The body is NOT repositioned here.
			 *
			 * It used to be — `position:relative;z-index:2` — from a time when this
			 * stylesheet was scoped to `.wp-site-blocks` and matched nothing on a
			 * classic theme. Once the scope was widened to `.site-content` the rule
			 * started applying, and at four classes it outranks the theme's own
			 * `.media-bg .dst-card .c-block__body{position:absolute}`. Every
			 * media-background card in the library stopped overlaying its picture
			 * and stacked its text underneath instead.
			 *
			 * The theme positions the body and gives it `z-index:2`; the scrim above
			 * sits on `--zIndex-overlay`, which is 1. Nothing more is needed, and
			 * anything more is a regression waiting to happen.
			 */

		/*
		 * The rule before a pretitle.
		 *
		 * At the top of the expressiveness dial the preview sets an eyebrow on a
		 * short accent bar — `content:""`, six times the accent rule wide, painted
		 * in the brand accent — and lays the pretitle out as an inline flex row so
		 * it shrinks to its text. The block package draws neither, so an imported
		 * pretitle lost its bar and stretched the full width of the band.
		 *
		 * `--sbs-accent-rule` already crosses over with the design dials; this is
		 * the rule that spends it, and it is gated on the same level the preview
		 * gates it on, so a restrained concept still gets no bar.
		 */
		if ( 'bold' === ( $theme['designDialLevels']['expression'] ?? '' ) ) {
			$rules .= "\n"
				. self::scoped( '.c-heading__pre', 'display:inline-flex;align-items:center;gap:9px' )
				. self::scoped( '.c-heading__pre::before', 'content:"";width:calc(var(--sbs-accent-rule,2px) * 6);height:var(--sbs-accent-rule,2px);background:var(--dst--primary-color2);flex:0 0 auto' );
		}

		$roots = ':root';
		foreach ( self::SCOPES as $scope ) {
			$roots .= '{' . $declarations . "}\n" . $scope;
		}
		return $roots . '{' . $declarations . "}\n" . $rules . "\n";
	}

	/**
	 * Every place an imported page is rendered.
	 *
	 * `.wp-site-blocks` and `.wp-block-post-content` are block-theme wrappers, and
	 * this is a classic theme: its `page.php` renders into
	 * `<main class="site-content">` and neither wrapper appears on the page at
	 * all. Every rule below was therefore written, enqueued and matched nothing —
	 * the card scrim, the reading measure, the media filters, all of it. The
	 * classic scope is now in the list, so the same stylesheet works on both.
	 */
	private const SCOPES = array( '.wp-site-blocks', '.wp-block-post-content', '.site-content', '.editor-styles-wrapper' );

	private static function scoped( string $selectors, string $declarations ): string {
		$scopes = self::SCOPES;
		$out    = array();
		foreach ( explode( ',', $selectors ) as $selector ) {
			$selector = trim( $selector );
			foreach ( $scopes as $scope ) {
				// An empty selector means the scope itself — that is where the
				// inherited properties (line-height, the motion variables) belong.
				$out[] = '' === $selector ? $scope : $scope . ' ' . $selector;
			}
		}
		return implode( ',', $out ) . '{' . $declarations . "}\n";
	}

	private static function reference_or_value( $value, array $colors ) {
		if ( is_string( $value ) && array_key_exists( $value, $colors ) ) {
			return 'var(--dst--' . sanitize_key( $value ) . ')';
		}
		return $value;
	}

	/**
	 * A design token is an absolute decision, so it is written in absolute units.
	 *
	 * The builder previews on `html{font-size:62.5%}` — the DST convention, one
	 * rem to ten pixels — and every size it exports is authored against that.
	 * This theme scales its root with the viewport instead: 48% above 1281px,
	 * 50% below, which is 7.68px at a 1440 desktop and 8px on a phone. So an
	 * exported `9.26rem` headline arrived at 71px instead of the 92.6px that was
	 * approved, and *every* size on the page was quietly multiplied by 0.768.
	 *
	 * Re-expressing the rem as rem cannot fix it: the root moves with the
	 * viewport, so no single multiplier is right at more than one width. Pixels
	 * are, and they reproduce the preview at every width.
	 *
	 * This converts only the values the export chose. The theme's own stylesheet
	 * keeps its rem and keeps scaling exactly as its authors intended.
	 */
	private const REM_PX = 10.0;

	private static function absolute_lengths( string $value ): string {
		return (string) preg_replace_callback(
			'/(-?\d*\.?\d+)rem\b/',
			static function ( array $m ): string {
				return rtrim( rtrim( number_format( (float) $m[1] * self::REM_PX, 4, '.', '' ), '0' ), '.' ) . 'px';
			},
			$value
		);
	}

	private static function add_var( array &$vars, string $name, $value ): void {
		if ( is_array( $value ) || is_object( $value ) || null === $value ) {
			return;
		}
		$value = self::absolute_lengths( trim( (string) $value ) );
		if ( '' === $value || ! self::safe_css_value( $value ) ) {
			return;
		}
		$vars[ $name ] = $value;
	}

	private static function safe_css_value( string $value ): bool {
		if ( strlen( $value ) > 300 || preg_match( '/[{};<>]|@import|expression\s*\(|javascript:|url\s*\(/i', $value ) ) {
			return false;
		}
		return (bool) preg_match( '/^[#(),.%\-+\/\s\w\'\"]+$/u', $value );
	}
}
