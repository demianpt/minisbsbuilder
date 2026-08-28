<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SBS_Importer_Block_Converter {
	private ?SBS_Importer_Block_Contract $contract = null;
	private array $warnings = array();
	private array $components = array();
	private int $block_count = 0;
	private array $unknown_attribute_sets = array();
	/** @var array<string,true> legacy attribute renames applied, for the report */
	private array $migrated_attributes = array();

	/** @return array{content:string,blocks:int,components:array<int,string>,warnings:array<int,string>}|WP_Error */
	public function page_to_content( array $artifact ) {
		$this->reset();
		$page = $artifact['concept']['page'] ?? null;
		if ( ! is_array( $page ) || ! isset( $page['sections'] ) || ! is_array( $page['sections'] ) ) {
			return new WP_Error( 'sbs_page_shape', __( 'The page artifact does not contain concept.page.sections.', 'sbs-website-importer' ) );
		}
		$blocks = array();
		foreach ( $page['sections'] as $section ) {
			if ( is_array( $section ) ) {
				$block = $this->node_to_block( $section, array( 'root' => true ) );
				if ( $block ) {
					$blocks[] = $block;
				}
			}
		}
		return $this->finish( $blocks );
	}

	/** @return array{content:string,blocks:int,components:array<int,string>,warnings:array<int,string>}|WP_Error */
	public function navigation_to_content( array $artifact, int $menu_id ) {
		$this->reset();
		$node = $artifact['concept']['global']['navigation'] ?? $artifact['concept']['templateParts']['navigation'] ?? null;
		if ( ! is_array( $node ) ) {
			return new WP_Error( 'sbs_navigation_shape', __( 'The navigation artifact does not contain an editable navigation block tree.', 'sbs-website-importer' ) );
		}
		$this->inject_navigation_menu_id( $node, $menu_id );
		$this->hydrate_navigation_content( $node );
		$block = $this->node_to_block( $node, array( 'root' => true ) );
		return $this->finish( $block ? array( $block ) : array() );
	}

	/** @return array{content:string,blocks:int,components:array<int,string>,warnings:array<int,string>}|WP_Error */
	public function footer_to_content( array $artifact ) {
		$this->reset();
		$node = $artifact['concept']['global']['footer'] ?? $artifact['concept']['templateParts']['footer'] ?? null;
		if ( ! is_array( $node ) ) {
			return new WP_Error( 'sbs_footer_shape', __( 'The footer artifact does not contain a footer definition.', 'sbs-website-importer' ) );
		}
		if ( ! empty( $node['importerShorthand'] ) && isset( $node['footer'] ) && is_array( $node['footer'] ) ) {
			$node = $this->expand_footer_shorthand( $node );
		}
		$block = $this->node_to_block( $node, array( 'root' => true ) );
		return $this->finish( $block ? array( $block ) : array() );
	}

	/**
	 * Attribute names the theme has since renamed.
	 *
	 * The slider controls were `enableLightSlider` / `lightSliderSettings` when
	 * parts of the pattern library were ingested, and the theme now reads
	 * `enableDstSlider` / `dstSliderSettings`. The settings object did not change
	 * shape — `showProgress`, `bleedRight`, `bleedRightVisibleItems`,
	 * `arrowsPosition` and the thumbnail keys all still mean what they meant — so
	 * this is a rename and nothing else.
	 *
	 * It matters because the old names are not wrong in a way anything notices.
	 * `c-cards` ignores them, renders the static grid it would have rendered with
	 * no slider at all, and reports success. The section arrives looking finished
	 * and quietly missing the one behaviour it was chosen for.
	 *
	 * Applied here rather than only in the builder because a bundle exported by an
	 * older build is still a bundle someone will import.
	 *
	 * @param array<string,mixed> $attrs
	 * @return array<string,mixed>
	 */
	private function migrate_legacy_attributes( string $name, array $attrs ): array {
		$renames = array(
			'ds-blocks/c-cards'            => array(
				'enableLightSlider'   => 'enableDstSlider',
				'lightSliderSettings' => 'dstSliderSettings',
			),
			'ds-blocks/dst-banner-slider'  => array(
				'lightSliderSettings' => 'dstSliderSettings',
			),
			'ds-blocks/dst-testimonials-slider' => array(
				'lightSliderSettings' => 'dstSliderSettings',
			),
		);

		foreach ( $renames[ $name ] ?? array() as $was => $now ) {
			if ( ! array_key_exists( $was, $attrs ) ) {
				continue;
			}
			// A value already under the current name is the newer decision and wins.
			if ( ! array_key_exists( $now, $attrs ) ) {
				$attrs[ $now ] = $attrs[ $was ];
			}
			unset( $attrs[ $was ] );
			$this->migrated_attributes[ $name . ': ' . $was . ' → ' . $now ] = true;
		}

		return $attrs;
	}

	/**
	 * Keys that belong to the builder and mean nothing here.
	 *
	 * `groupTheme` tells the *preview* which button variant to draw. WordPress
	 * picks the variant from the band's own tone class, so carrying the key across
	 * only produces a warning about an attribute nobody will ever read. The export
	 * strips it as well; this is the second line, for a JSON written by an older
	 * build of the builder.
	 *
	 * @param array<string,mixed> $attrs
	 * @return array<string,mixed>
	 */
	private function strip_builder_internals( string $name, array $attrs ): array {
		$internal = array(
			'ds-blocks/c-btn' => array( 'groupTheme' ),
		);
		foreach ( $internal[ $name ] ?? array() as $key ) {
			unset( $attrs[ $key ] );
		}
		return $attrs;
	}

	private function contract(): SBS_Importer_Block_Contract {
		return $this->contract ??= new SBS_Importer_Block_Contract();
	}

	private function reset(): void {
		$this->warnings = array();
		$this->components = array();
		$this->block_count = 0;
		$this->unknown_attribute_sets = array();
		$this->migrated_attributes = array();
	}

	/** @param array<int,array> $blocks */
	private function finish( array $blocks ): array {
		$content = function_exists( 'serialize_blocks' ) ? serialize_blocks( $blocks ) : $this->serialize_blocks_fallback( $blocks );
		$components = array_values( array_unique( $this->components ) );
		sort( $components );
		return array(
			'content'    => $content,
			'blocks'     => $this->block_count,
			'components' => $components,
			'warnings'   => array_values( array_unique( $this->warnings ) ),
		);
	}

	private function node_to_block( array $node, array $context = array() ): ?array {
		$name = isset( $node['component'] ) ? sanitize_text_field( (string) $node['component'] ) : '';
		if ( '' === $name || ! preg_match( '#^[a-z0-9-]+/[a-z0-9-]+$#', $name ) ) {
			$this->warnings[] = __( 'A node without a valid Gutenberg block name was skipped.', 'sbs-website-importer' );
			return null;
		}
		$this->block_count++;
		$this->components[] = $name;

		$attrs = isset( $node['attributes'] ) && is_array( $node['attributes'] ) ? $this->sanitize_value( $node['attributes'] ) : array();
		$attrs = $this->migrate_legacy_attributes( $name, $attrs );
		$attrs = $this->absolute_lengths( $attrs );
		$attrs = $this->strip_builder_internals( $name, $attrs );
		$attrs = $this->merge_node_metadata( $name, $attrs, $node, $context );
		if ( 'ds-blocks/dst-site-logo' === $name ) {
			$attrs = $this->resolve_site_logo( $attrs );
		}
		$this->record_unknown_attributes( $name, $attrs );

		$children = array();
		foreach ( (array) ( $node['children'] ?? array() ) as $child ) {
			if ( is_array( $child ) ) {
				$converted = $this->node_to_block( $child, array( 'parent' => $name ) );
				if ( $converted ) {
					$children[] = $converted;
				}
			}
		}

		if ( str_starts_with( $name, 'core/' ) ) {
			return $this->core_block( $name, $attrs, $children, $node );
		}

		return array(
			'blockName'    => $name,
			'attrs'        => $attrs,
			'innerBlocks'  => $children,
			'innerHTML'    => '',
			'innerContent' => array_fill( 0, count( $children ), null ),
		);
	}

	/**
	 * Turns a sideloaded logo file into the attachment id the block reads.
	 *
	 * `ds-blocks/dst-site-logo` takes `customLogoId`, an attachment id. The
	 * artifact carries the file as a media object so the sideloader can fetch it
	 * and write the id back; this is where that id becomes the attribute and the
	 * carrier is dropped, so nothing the block does not declare reaches the page.
	 */
	private function resolve_site_logo( array $attrs ): array {
		if ( ! isset( $attrs['customLogo'] ) || ! is_array( $attrs['customLogo'] ) ) {
			return $attrs;
		}
		$id = absint( $attrs['customLogo']['id'] ?? 0 );
		unset( $attrs['customLogo'] );
		if ( $id ) {
			$attrs['customLogoId'] = $id;
			$attrs['logoSource'] = 'custom';
		} else {
			// Nothing was fetched, so the block falls back to the site's own logo
			// rather than pointing at a file this install does not have.
			$this->warnings[] = __( 'The navigation logo file could not be fetched; the site logo is used instead.', 'sbs-website-importer' );
			unset( $attrs['logoSource'] );
		}
		return $attrs;
	}

	private function merge_node_metadata( string $name, array $attrs, array $node, array $context ): array {
		/*
		 * Asked of the contract, not of `block.json`. The theme adds `dsPadding`,
		 * `dsEffects`, `dsContainer` and `classVariant` from JavaScript, so a
		 * `block.json` lookup answers "no" for every one of them and this method
		 * used to refuse to write them — losing the band spacing and the scroll
		 * effects of every section whose export carries them on the node.
		 */
		$contract = $this->contract();
		$has_attr = static fn( string $key ): bool => $contract->accepts( $name, $key );

		if ( isset( $node['pattern'] ) && $has_attr( 'dsPatternAppliedPatternId' ) ) {
			$current_pattern = (string) ( $attrs['dsPatternAppliedPatternId'] ?? '' );
			if ( '' === $current_pattern || ! str_starts_with( $current_pattern, 'sbs-' ) ) {
				$attrs['dsPatternAppliedPatternId'] = sanitize_text_field( (string) $node['pattern'] );
			}
		}
		if ( isset( $node['decorations'] ) && is_array( $node['decorations'] ) && ! isset( $attrs['decorations'] ) && $has_attr( 'decorations' ) ) {
			$attrs['decorations'] = $this->sanitize_value( $node['decorations'] );
		}
		if ( isset( $node['classVariant'] ) && ! isset( $attrs['classVariant'] ) && $has_attr( 'classVariant' ) ) {
			$attrs['classVariant'] = sanitize_text_field( (string) $node['classVariant'] );
		}
		if ( isset( $node['dsEffects'] ) && is_array( $node['dsEffects'] ) && ! isset( $attrs['dsEffects'] ) && $has_attr( 'dsEffects' ) ) {
			$attrs['dsEffects'] = $this->sanitize_value( $node['dsEffects'] );
		}
		if ( ! empty( $node['inverted'] ) ) {
			$key = $has_attr( 'className' ) ? 'className' : ( $has_attr( 'class' ) ? 'class' : '' );
			if ( $key ) {
				$classes = preg_split( '/\s+/', trim( (string) ( $attrs[ $key ] ?? '' ) ) ) ?: array();
				$classes[] = 'is-style-colors-inverted';
				$attrs[ $key ] = implode( ' ', array_unique( array_filter( $classes ) ) );
			}
		}

		$layout = isset( $node['layout'] ) && is_array( $node['layout'] ) ? $node['layout'] : array();
		if ( ! isset( $attrs['dsPadding'] ) && $has_attr( 'dsPadding' ) && isset( $layout['padding'] ) && is_array( $layout['padding'] ) ) {
			$attrs['dsPadding'] = array(
				'top'    => $this->spacing_axis( $layout['padding']['top'] ?? 'none' ),
				'bottom' => $this->spacing_axis( $layout['padding']['bottom'] ?? 'none' ),
			);
		}
		/*
		 * The band's own margin, which had nowhere to land.
		 *
		 * The export moves `dsMargin` off the attributes and onto `layout.margin`,
		 * exactly as it does with padding — and nothing here ever read it back, so
		 * every margin a strategist set arrived as the block's default. It is the
		 * same shape as padding and the theme reads the same two sides, so it is
		 * rebuilt the same way.
		 */
		if ( ! isset( $attrs['dsMargin'] ) && $has_attr( 'dsMargin' ) && isset( $layout['margin'] ) && is_array( $layout['margin'] ) ) {
			$margin = array();
			foreach ( array( 'top', 'bottom' ) as $side ) {
				if ( isset( $layout['margin'][ $side ] ) && '' !== $layout['margin'][ $side ] ) {
					$margin[ $side ] = $this->spacing_axis( $layout['margin'][ $side ] );
				}
			}
			if ( ! empty( $margin ) ) {
				$attrs['dsMargin'] = $margin;
			}
		}
		if ( ! isset( $attrs['dsContainer'] ) && $has_attr( 'dsContainer' ) && isset( $layout['container'] ) ) {
			$container = (string) $layout['container'];
			/*
			 * `container-wide` is an editor-only class.
			 *
			 * The theme styles it under `.editor-styles-wrapper` and nowhere else,
			 * so on the front end a band asking for the builder's widest measure
			 * matched no rule at all — and a block with no container class is a
			 * plain child of the constrained page root, which WordPress caps at
			 * `--wp--style--global--content-size`. That is `var(--blog-width,850px)`
			 * here, so the widest sections in the library came out the narrowest.
			 *
			 * Measured against the live theme, the front end renders `container`
			 * (the default measure), `container-alt`, `container-alt-2`,
			 * `container-alt-3`, `container-custom` and `container-fluid`. There is
			 * no wider one, so `wide` resolves to the default measure, which is
			 * what the preview draws it at.
			 */
			$map = array( 'default' => '', 'alt' => 'container-alt', 'wide' => 'container', 'full' => '', 'custom' => 'container-custom' );
			if ( isset( $map[ $container ] ) ) {
				$attrs['dsContainer'] = $map[ $container ];
			}
		}
		if ( ! isset( $attrs['dsContainerCustom'] ) && $has_attr( 'dsContainerCustom' ) && isset( $layout['containerCustom'] ) ) {
			$attrs['dsContainerCustom'] = sanitize_text_field( (string) $layout['containerCustom'] );
		}
		$background = isset( $layout['background'] ) && is_array( $layout['background'] ) ? $layout['background'] : array();
		if ( ! isset( $attrs['backgroundColor'] ) && $has_attr( 'backgroundColor' ) && ! empty( $background ) ) {
			$kind = (string) ( $background['kind'] ?? '' );
			if ( 'literal' === $kind && isset( $background['value'] ) ) {
				$attrs['backgroundColor'] = sanitize_text_field( (string) $background['value'] );
			} elseif ( 'slot' === $kind && ! empty( $background['slot'] ) ) {
				$attrs['backgroundColor'] = 'var(--dst--' . sanitize_key( (string) $background['slot'] ) . ')';
			}
		}
		if ( ! isset( $attrs['gradient'] ) && $has_attr( 'gradient' ) && 'gradient' === ( $background['kind'] ?? '' ) && ! empty( $background['ref'] ) ) {
			$attrs['gradient'] = sanitize_text_field( (string) $background['ref'] );
		}
		return $attrs;
	}

	private function record_unknown_attributes( string $name, array $attrs ): void {
		if ( ! str_starts_with( $name, 'ds-blocks/' ) ) {
			return;
		}
		/*
		 * The same contract the writer uses, so a warning means the theme really
		 * will ignore the setting. Reported against `block.json` alone, this told
		 * the strategist that `dsPadding` and `dsContainerSideGap` were unknown on
		 * six blocks per import — attributes the theme applies on every page.
		 */
		$unknown = $this->contract()->unknown( $name, $attrs );
		if ( empty( $unknown ) ) {
			return;
		}
		$key = $name . ':' . implode( ',', $unknown );
		if ( isset( $this->unknown_attribute_sets[ $key ] ) ) {
			return;
		}
		$this->unknown_attribute_sets[ $key ] = true;
		$this->warnings[] = sprintf(
			/* translators: 1: block name, 2: comma-separated attributes. */
			__( '%1$s contains attributes not registered by the active block package: %2$s. They were preserved for forward compatibility.', 'sbs-website-importer' ),
			$name,
			implode( ', ', $unknown )
		);
	}

	private function spacing_axis( $value ): array {
		if ( is_array( $value ) ) {
			return $this->sanitize_value( $value );
		}
		return array( 'type' => sanitize_key( (string) $value ), 'desktop' => '', 'mobile' => '' );
	}

	private function core_block( string $name, array $attrs, array $children, array $node ): array {
		switch ( $name ) {
			case 'core/paragraph':
				/*
				 * `node['text']` first.
				 *
				 * The builder moves a paragraph's words onto the node — its export
				 * normalizer does `node.text = node.text || attrs.content` and then
				 * deletes the attribute — and this only ever looked at the attribute
				 * and at `content.text`. So every paragraph in every artifact
				 * imported blank: body copy, the footer description, the legal line,
				 * the announcement bar. Nothing reported it, because an empty
				 * paragraph is a valid block.
				 */
				$content = $this->safe_rich_text( $node['text'] ?? $attrs['content'] ?? $node['content']['text'] ?? '' );
				unset( $attrs['content'], $attrs['placeholder'] );
				$class = ! empty( $attrs['className'] ) ? ' class="' . esc_attr( $attrs['className'] ) . '"' : '';
				$html = '<p' . $class . '>' . $content . '</p>';
				return $this->static_block( $name, $attrs, $html );
			case 'core/heading':
				$content = $this->safe_rich_text( $node['text'] ?? $attrs['content'] ?? '' );
				$level = max( 1, min( 6, (int) ( $attrs['level'] ?? 2 ) ) );
				unset( $attrs['content'] );
				$html = sprintf( '<h%d class="wp-block-heading">%s</h%d>', $level, $content, $level );
				return $this->static_block( $name, $attrs, $html );
			case 'core/list-item':
				$content = $this->safe_rich_text( $node['text'] ?? $attrs['content'] ?? $node['content']['text'] ?? '' );
				unset( $attrs['content'] );
				$html = '<li>' . $content . '</li>';
				return $this->static_block( $name, $attrs, $html );
			case 'core/list':
				$tag = ! empty( $attrs['ordered'] ) ? 'ol' : 'ul';
				$inner = array( '<' . $tag . ' class="wp-block-list">' );
				foreach ( $children as $unused ) {
					$inner[] = null;
				}
				$inner[] = '</' . $tag . '>';
				return array( 'blockName' => $name, 'attrs' => $attrs, 'innerBlocks' => $children, 'innerHTML' => '', 'innerContent' => $inner );
			case 'core/html':
				$html = wp_kses_post( (string) ( $attrs['content'] ?? $node['content']['html'] ?? '' ) );
				unset( $attrs['content'] );
				return $this->static_block( $name, $attrs, $html );
			default:
				return array( 'blockName' => $name, 'attrs' => $attrs, 'innerBlocks' => $children, 'innerHTML' => '', 'innerContent' => array_fill( 0, count( $children ), null ) );
		}
	}

	/**
	 * Attributes whose value is a length the design chose, not prose.
	 *
	 * Matched on the attribute name so a sentence is never rewritten: a caption
	 * reading "the 4rem rule" keeps its words, `cardItemPadding` does not.
	 */
	private const LENGTH_KEYS = '/(padding|margin|gap|radius|width|height|size|spacing|offset|inset|indent|track|top|right|bottom|left)/i';

	/**
	 * One rem is ten pixels to the builder, and something else here.
	 *
	 * The preview runs on `html{font-size:62.5%}` — the DST convention — so every
	 * `2.4rem` gap and `4rem` card padding the export carries means exactly 24px
	 * and 40px. This theme scales its root with the viewport instead: 48% above
	 * 1281px and 50% below, which is 7.68px at a 1440 desktop. Every one of those
	 * lengths therefore arrived at roughly three quarters of the size that was
	 * approved, and the page read as a tighter, smaller version of the preview
	 * without a single attribute being lost.
	 *
	 * Restating them in rem cannot fix it, because the root moves with the
	 * viewport and no single multiplier is right at more than one width. Pixels
	 * are. Only the values the export chose are rewritten; the theme's own
	 * stylesheet keeps its rem and keeps scaling as its authors intended.
	 */
	private function absolute_lengths( $value, bool $is_length = false ) {
		if ( is_array( $value ) ) {
			$out = array();
			foreach ( $value as $key => $child ) {
				$out[ $key ] = $this->absolute_lengths(
					$child,
					$is_length || ( is_string( $key ) && (bool) preg_match( self::LENGTH_KEYS, $key ) )
				);
			}
			return $out;
		}
		if ( ! $is_length || ! is_string( $value ) || ! str_contains( $value, 'rem' ) ) {
			return $value;
		}
		return preg_replace_callback(
			'/(?<![\w.-])(-?\d*\.?\d+)rem\b/',
			static function ( array $m ): string {
				return rtrim( rtrim( number_format( (float) $m[1] * 10.0, 4, '.', '' ), '0' ), '.' ) . 'px';
			},
			$value
		);
	}

	private function static_block( string $name, array $attrs, string $html ): array {
		return array( 'blockName' => $name, 'attrs' => $attrs, 'innerBlocks' => array(), 'innerHTML' => $html, 'innerContent' => array( $html ) );
	}

	private function safe_rich_text( $value ): string {
		return wp_kses_post( (string) $value );
	}

	private function sanitize_value( $value ) {
		if ( is_array( $value ) ) {
			$out = array();
			foreach ( $value as $key => $child ) {
				if ( is_int( $key ) ) {
					$safe_key = $key;
				} else {
					$key = (string) $key;
					if ( ! preg_match( '/^[A-Za-z0-9_.:\-]+$/', $key ) ) {
						continue;
					}
					$safe_key = $key;
				}
				$out[ $safe_key ] = $this->sanitize_value( $child );
			}
			return $out;
		}
		if ( is_bool( $value ) || is_int( $value ) || is_float( $value ) || null === $value ) {
			return $value;
		}
		if ( is_string( $value ) ) {
			if ( preg_match( '/<[^>]+>/', $value ) ) {
				return wp_kses_post( $value );
			}
			return sanitize_text_field( $value );
		}
		return null;
	}

	/**
	 * Writes a menu id into a menu block that has no location to read.
	 *
	 * A 2.0 artifact's blocks name a location — `menuSource: 'location'`,
	 * `menuLocation: 'primary-menu'` — which is what the theme reads, and the
	 * importer has already pointed that location at the menu it built. Writing an
	 * id as well would add an attribute the theme's block does not declare, so
	 * this now only fills in for a 1.0 artifact that names no location at all.
	 */
	private function inject_navigation_menu_id( array &$node, int $menu_id ): void {
		if ( 'ds-blocks/dst-navigation-menu' === ( $node['component'] ?? '' ) ) {
			$node['attributes'] = isset( $node['attributes'] ) && is_array( $node['attributes'] ) ? $node['attributes'] : array();
			$located = '' !== (string) ( $node['attributes']['menuLocation'] ?? '' );
			if ( ! $located && $menu_id ) {
				$node['attributes']['menuId'] = (int) $menu_id;
				$node['attributes']['menuSource'] = 'custom';
			}
		}
		if ( ! empty( $node['children'] ) && is_array( $node['children'] ) ) {
			foreach ( $node['children'] as &$child ) {
				if ( is_array( $child ) ) {
					$this->inject_navigation_menu_id( $child, $menu_id );
				}
			}
			unset( $child );
		}
	}

	private function hydrate_navigation_content( array &$node ): void {
		if ( 'ds-blocks/dst-navigation-announcement' === ( $node['component'] ?? '' ) && empty( $node['children'] ) ) {
			$text = (string) ( $node['content']['text'] ?? '' );
			if ( '' !== trim( $text ) ) {
				$node['children'] = array( $this->simple_text_node( $text, 'navigation-announcement-text' ) );
			}
		}
		if ( ! empty( $node['children'] ) && is_array( $node['children'] ) ) {
			foreach ( $node['children'] as &$child ) {
				if ( is_array( $child ) ) {
					$this->hydrate_navigation_content( $child );
				}
			}
			unset( $child );
		}
	}

	private function expand_footer_shorthand( array $node ): array {
		$f = $node['footer'];
		$root_attrs = isset( $node['attributes'] ) && is_array( $node['attributes'] ) ? $node['attributes'] : array();
		$root_attrs['htmlTag'] = 'footer';
		$root_attrs['fullWidthWrapper'] = true;
		$root_attrs['backgroundColor'] = $root_attrs['backgroundColor'] ?? 'var(--dst--body-bg-alt)';

		$children = array();
		$top = isset( $f['top'] ) && is_array( $f['top'] ) ? $f['top'] : array();
		$top_heading = array(
			'id' => 'footer-top-heading',
			'component' => 'ds-blocks/c-heading',
			'attributes' => array(
				'pretitle' => (string) ( $f['brand']['text'] ?? '' ),
				'title' => (string) ( $top['heading'] ?? '' ),
				'subtitle' => (string) ( $top['subheading'] ?? '' ),
				'showPretitle' => ! empty( $f['brand']['text'] ),
				'showSubtitle' => ! empty( $top['subheading'] ),
				'showDescription' => true,
				'headingTheme' => 'inverted',
				'alignment' => 'left',
				'alignmentMobile' => 'left',
			),
			'children' => array(),
		);
		if ( ! empty( $top['cta']['label'] ) ) {
			$top_heading['children'][] = array(
				'id' => 'footer-top-buttons', 'component' => 'ds-blocks/button-group', 'attributes' => array(),
				'children' => array(
					array( 'id' => 'footer-top-cta', 'component' => 'ds-blocks/c-btn', 'attributes' => array( 'text' => (string) $top['cta']['label'], 'link' => array( 'url' => (string) ( $top['cta']['url'] ?? '#' ) ), 'btnType' => (string) ( $top['cta']['btnType'] ?? 'primary-inverted' ), 'hasIcon' => false ), 'children' => array() ),
				),
			);
		}
		$children[] = $top_heading;

		$columns = array();
		foreach ( (array) ( $f['columns'] ?? array() ) as $index => $column ) {
			if ( ! is_array( $column ) ) {
				continue;
			}
			$column_children = array();
			if ( 'brand' === ( $column['kind'] ?? '' ) ) {
				$column_children[] = array(
					'id' => 'footer-brand-copy', 'component' => 'ds-blocks/c-heading',
					'attributes' => array( 'title' => (string) ( $f['brand']['text'] ?? '' ), 'subtitle' => (string) ( $column['body'] ?? '' ), 'showSubtitle' => ! empty( $column['body'] ), 'titleTypography' => $f['headingTypography'] ?? array(), 'headingTheme' => 'inverted' ),
					'children' => array(),
				);
				if ( ! empty( $node['children'] ) ) {
					foreach ( $node['children'] as $original_child ) {
						if ( is_array( $original_child ) ) {
							$column_children[] = $original_child;
						}
					}
				}
			} else {
				$items = array();
				foreach ( (array) ( $column['links'] ?? array() ) as $link_index => $link ) {
					$items[] = array(
						'id' => 'footer-link-' . $index . '-' . $link_index,
						'component' => 'ds-blocks/c-list-item',
						'attributes' => array( 'listTitle' => '<a href="' . esc_url( $link['url'] ?? '#' ) . '">' . esc_html( $link['label'] ?? '' ) . '</a>' ),
						'children' => array(),
					);
				}
				if ( ! empty( $column['heading'] ) ) {
					$column_children[] = array(
						'id' => 'footer-menu-heading-' . $index,
						'component' => 'ds-blocks/c-heading',
						'attributes' => array(
							'title' => (string) $column['heading'],
							'showPretitle' => false,
							'showSubtitle' => false,
							'showDescription' => false,
							'headingTheme' => 'inverted',
							'titleTypography' => $f['headingTypography'] ?? array(),
						),
						'children' => array(),
					);
				}
				$column_children[] = array(
					'id' => 'footer-menu-' . $index, 'component' => 'ds-blocks/c-list',
					'attributes' => array( 'showTitle' => false, 'showIcons' => false, 'showSubtitle' => false, 'colCount' => 1, 'colCountTablet' => 1, 'colCountMobile' => 1 ),
					'children' => $items,
				);
			}
			$columns[] = array( 'id' => 'footer-column-' . $index, 'component' => 'ds-blocks/ds-column', 'attributes' => array(), 'children' => $column_children );
		}
		if ( $columns ) {
			$children[] = array(
				'id' => 'footer-columns', 'component' => 'ds-blocks/ds-columns',
				'attributes' => array( 'count' => count( $columns ), 'desktopColumnsPerRow' => count( $columns ), 'tabletCount' => (int) ( $f['columnsTablet'] ?? 2 ), 'mobileCount' => (int) ( $f['columnsMobile'] ?? 1 ), 'gap' => '4rem', 'verticalAlign' => 'start' ),
				'children' => $columns,
			);
		}

		$bottom = isset( $f['bottom'] ) && is_array( $f['bottom'] ) ? $f['bottom'] : array();
		$bottom_children = array(
			array( 'id' => 'footer-copyright', 'component' => 'ds-blocks/simple-text', 'attributes' => array(), 'children' => array( $this->paragraph_node( (string) ( $bottom['copyright'] ?? '' ), 'footer-copyright-text' ) ) ),
		);
		$privacy_items = array();
		foreach ( (array) ( $bottom['privacyMenu']['links'] ?? array() ) as $i => $link ) {
			$privacy_items[] = array( 'id' => 'footer-privacy-' . $i, 'component' => 'ds-blocks/c-list-item', 'attributes' => array( 'listTitle' => '<a href="' . esc_url( $link['url'] ?? '#' ) . '">' . esc_html( $link['label'] ?? '' ) . '</a>' ), 'children' => array() );
		}
		if ( $privacy_items ) {
			$bottom_children[] = array( 'id' => 'footer-privacy-list', 'component' => 'ds-blocks/c-list', 'attributes' => array( 'showIcons' => false, 'layoutVariant' => 'flex', 'alignment' => 'row', 'colCount' => count( $privacy_items ) ), 'children' => $privacy_items );
		}
		$children[] = array( 'id' => 'footer-bottom', 'component' => 'ds-blocks/ds-columns', 'attributes' => array( 'count' => 2, 'desktopColumnsPerRow' => 2, 'tabletCount' => 1, 'mobileCount' => 1, 'gap' => '2rem', 'verticalAlign' => 'center' ), 'children' => array(
			array( 'id' => 'footer-bottom-copy', 'component' => 'ds-blocks/ds-column', 'attributes' => array(), 'children' => array_slice( $bottom_children, 0, 1 ) ),
			array( 'id' => 'footer-bottom-links', 'component' => 'ds-blocks/ds-column', 'attributes' => array( 'alignHorizontal' => 'right' ), 'children' => array_slice( $bottom_children, 1 ) ),
		) );

		return array(
			'id' => $node['id'] ?? 'site-footer',
			'component' => 'ds-blocks/dst-wrapper',
			'attributes' => $root_attrs,
			'inverted' => true,
			'decorations' => $node['decorations'] ?? array(),
			'children' => $children,
		);
	}

	private function simple_text_node( string $text, string $id ): array {
		return array( 'id' => $id, 'component' => 'ds-blocks/simple-text', 'attributes' => array(), 'children' => array( $this->paragraph_node( $text, $id . '-paragraph' ) ) );
	}

	private function paragraph_node( string $text, string $id ): array {
		return array( 'id' => $id, 'component' => 'core/paragraph', 'attributes' => array( 'content' => $text ), 'children' => array() );
	}

	private function serialize_blocks_fallback( array $blocks ): string {
		$out = '';
		foreach ( $blocks as $block ) {
			$out .= $this->serialize_block_fallback( $block );
		}
		return $out;
	}

	private function serialize_block_fallback( array $block ): string {
		$name = $block['blockName'];
		$comment_name = str_starts_with( $name, 'core/' ) ? substr( $name, 5 ) : $name;
		$attrs = empty( $block['attrs'] ) ? '' : ' ' . wp_json_encode( $block['attrs'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		$content = '';
		$index = 0;
		foreach ( $block['innerContent'] as $chunk ) {
			$content .= is_string( $chunk ) ? $chunk : $this->serialize_block_fallback( $block['innerBlocks'][ $index++ ] );
		}
		return '<!-- wp:' . $comment_name . $attrs . ' -->' . $content . '<!-- /wp:' . $comment_name . ' -->';
	}
}
