<?php
/**
 * What the importer is allowed to write, on a real site.
 *
 * The plugin asked `WP_Block_Type_Registry` whether a block accepted an
 * attribute, and used the answer to decide whether to write it. On a real site
 * that answer comes from `block.json` alone — and the theme adds a second set of
 * controls from JavaScript, keyed on `supports`: `dsGapControl` adds `dsPadding`,
 * `dsContainers` adds the container family, `dsEffects` adds `dsEffects`.
 *
 * So every scroll effect and every band padding the export carried on a *node*
 * rather than inside `attributes` was silently refused, and the strategist was
 * told those attributes were "not registered by the active block package".
 *
 * The plugin's own tests could not see it: their fixture registry is built from
 * the builder's snapshot, which already lists the HOC names. This file registers
 * a block the way WordPress does — declared attributes plus supports flags — and
 * asserts the settings still land.
 *
 *   php tests/wordpress/importer-contract.php
 */
declare( strict_types=1 );

require_once __DIR__ . '/bootstrap.php';
$root = dirname( __DIR__, 2 );
require_once $root . '/wordpress-plugin/sbs-website-importer/includes/class-sbs-importer-block-contract.php';
require_once $root . '/wordpress-plugin/sbs-website-importer/includes/class-sbs-importer-block-converter.php';

$results = array();
$assert = static function ( string $label, bool $passed ) use ( &$results ): void {
	$results[] = array( 'label' => $label, 'passed' => $passed );
};

$registry = WP_Block_Type_Registry::get_instance();

/*
 * A wrapper as a real site registers it: the twelve attributes `block.json`
 * declares, and the supports flags the theme turns into controls. Note what is
 * absent — dsPadding, dsEffects, dsContainer, classVariant.
 */
$registry->register_fixture(
	'ds-blocks/dst-wrapper',
	array(
		'anchor' => true, 'backgroundColor' => true, 'backgroundImage' => true, 'backgroundOverlay' => true,
		'backgroundOverlayBlur' => true, 'backgroundOverlayEnabled' => true, 'backgroundOverlayMixBlend' => true,
		'borderRadius' => true, 'borderRadiusCustom' => true, 'borderRadiusCustomMobile' => true,
		'decorations' => true, 'fullWidthWrapper' => true,
	),
	array( 'anchor' => true, 'dsGapControl' => true, 'dsContainers' => true, 'dsEffects' => true, 'dsDeactivate' => true )
);

$contract = new SBS_Importer_Block_Contract();

$assert( 'a declared attribute is accepted', $contract->accepts( 'ds-blocks/dst-wrapper', 'backgroundColor' ) );
$assert( 'dsPadding is accepted from dsGapControl', $contract->accepts( 'ds-blocks/dst-wrapper', 'dsPadding' ) );
$assert( 'dsMargin is accepted from dsGapControl', $contract->accepts( 'ds-blocks/dst-wrapper', 'dsMargin' ) );
$assert( 'dsEffects is accepted from dsEffects', $contract->accepts( 'ds-blocks/dst-wrapper', 'dsEffects' ) );
$assert( 'dsContainerSideGap is accepted from dsContainers', $contract->accepts( 'ds-blocks/dst-wrapper', 'dsContainerSideGap' ) );
$assert( 'an invented attribute is still refused', ! $contract->accepts( 'ds-blocks/dst-wrapper', 'notARealControl' ) );
$assert(
	'the HOC attributes are not reported as unknown',
	array() === $contract->unknown( 'ds-blocks/dst-wrapper', array( 'dsPadding' => array(), 'dsEffects' => array(), 'dsContainerSideGap' => true ) )
);
$assert(
	'an invented attribute is reported',
	array( 'notARealControl' ) === $contract->unknown( 'ds-blocks/dst-wrapper', array( 'notARealControl' => 1 ) )
);
$assert(
	'a block this site does not have is left alone',
	$contract->accepts( 'ds-blocks/not-installed', 'anything' )
		&& array() === $contract->unknown( 'ds-blocks/not-installed', array( 'anything' => 1 ) )
);

/*
 * The end-to-end shape of the bug: a section whose motion and padding live on the
 * node. Before the contract, both were dropped and the page arrived static and
 * flush against its neighbours.
 */
$converter = new SBS_Importer_Block_Converter();
$artifact = array(
	'concept' => array(
		'page' => array(
			'sections' => array(
				array(
					'id'         => 'section-1',
					'component'  => 'ds-blocks/dst-wrapper',
					'attributes' => array( 'fullWidthWrapper' => true ),
					'dsEffects'  => array( 'type' => 'fade-up', 'mode' => 'trigger' ),
					'layout'     => array( 'container' => 'wide', 'padding' => array( 'top' => 'large', 'bottom' => 'large' ), 'margin' => array( 'top' => 'medium' ) ),
					'children'   => array(),
				),
			),
		),
	),
);
$converted = $converter->page_to_content( $artifact );
$content = is_array( $converted ) ? (string) $converted['content'] : '';

$assert( 'the section converts', is_array( $converted ) );
$assert( 'the scroll effect reaches WordPress', str_contains( $content, '"dsEffects"' ) && str_contains( $content, 'fade-up' ) );
$assert( 'the band padding reaches WordPress', str_contains( $content, '"dsPadding"' ) && str_contains( $content, 'large' ) );
$assert( 'the container choice reaches WordPress', str_contains( $content, '"dsContainer"' ) );
/*
 * Margin travels the same road as padding and used to fall off the end of it:
 * the export moves it to `layout.margin`, and nothing read it back.
 */
$assert( 'the band margin reaches WordPress', str_contains( $content, '"dsMargin"' ) && str_contains( $content, 'medium' ) );
$assert(
	'no warning is raised about attributes the theme applies',
	! (bool) preg_grep( '/dsPadding|dsEffects|dsContainer/', (array) $converted['warnings'] )
);

/*
 * A slider exported under the theme's old attribute names.
 *
 * `enableLightSlider`/`lightSliderSettings` are what these controls were called
 * when part of the pattern library was ingested; `c-cards` reads
 * `enableDstSlider`/`dstSliderSettings` now. The old names are not rejected by
 * anything — the block simply does not read them, so the section imports as the
 * static grid it would have been with no slider at all and reports success.
 * A bundle written by an older builder is still a bundle someone will import,
 * so the rename happens here rather than only at export.
 */
$registry->register_fixture(
	'ds-blocks/c-cards',
	array( 'anchor' => true, 'columns' => true, 'enableDstSlider' => true, 'dstSliderSettings' => true ),
	array( 'anchor' => true, 'dsGapControl' => true, 'dsContainers' => true, 'dsEffects' => true )
);

$legacy = new SBS_Importer_Block_Converter();
$legacy_artifact = array(
	'concept' => array(
		'page' => array(
			'sections' => array(
				array(
					'id'         => 'section-slider',
					'component'  => 'ds-blocks/c-cards',
					'attributes' => array(
						'columns'             => 3,
						'enableLightSlider'   => true,
						'lightSliderSettings' => array( 'showProgress' => true, 'arrowsPosition' => 'bottom' ),
					),
					'children'   => array(),
				),
			),
		),
	),
);
$legacy_out     = $legacy->page_to_content( $legacy_artifact );
$legacy_content = is_array( $legacy_out ) ? (string) $legacy_out['content'] : '';

$assert( 'the legacy slider section converts', is_array( $legacy_out ) );
$assert( 'the slider is enabled under the name the theme reads', str_contains( $legacy_content, '"enableDstSlider":true' ) );
$assert( 'the slider settings are carried over, not dropped', str_contains( $legacy_content, '"dstSliderSettings"' ) && str_contains( $legacy_content, 'arrowsPosition' ) );
$assert( 'the retired slider names are gone', ! str_contains( $legacy_content, 'enableLightSlider' ) && ! str_contains( $legacy_content, 'lightSliderSettings' ) );
$assert(
	'no warning is raised about the renamed slider controls',
	! (bool) preg_grep( '/LightSlider|lightSlider/', (array) $legacy_out['warnings'] )
);

$registry->forget_fixture( 'ds-blocks/c-cards' );

/*
 * A length the design chose, against a root the host theme moves.
 *
 * The builder previews on `html{font-size:62.5%}`, so `2.4rem` in an exported
 * attribute means 24px. This theme sets its root to 48% above 1281px, which
 * makes the same string mean 18.4px — and it does that to every gap, padding
 * and radius at once, so the page arrives as a smaller, tighter copy of itself
 * with no attribute missing and nothing to warn about.
 *
 * Prose is matched on the attribute *name*, not the value, so a caption that
 * happens to mention a measurement keeps its words.
 */
$registry->register_fixture(
	'ds-blocks/dst-spacer',
	array( 'gapVertical' => true, 'cardItemPadding' => true, 'borderRadiusCustom' => true, 'listTitle' => true, 'imageTextRatio' => true ),
	array( 'anchor' => true )
);

$lengths     = new SBS_Importer_Block_Converter();
$length_page = $lengths->page_to_content(
	array(
		'concept' => array(
			'page' => array(
				'sections' => array(
					array(
						'id'         => 'section-lengths',
						'component'  => 'ds-blocks/dst-spacer',
						'attributes' => array(
							'gapVertical'        => '2.4rem',
							'cardItemPadding'    => array( 'top' => '4rem', 'right' => '2rem', 'bottom' => '0', 'left' => 'var(--dst--x)' ),
							'borderRadiusCustom' => '0 0 0 4rem',
							'imageTextRatio'     => '32%',
							'listTitle'          => 'Cut to a 4rem margin, by hand',
						),
						'children'   => array(),
					),
				),
			),
		),
	)
);
$length_content = is_array( $length_page ) ? (string) $length_page['content'] : '';

$assert( 'a scalar length is restated in pixels', str_contains( $length_content, '"gapVertical":"24px"' ) );
$assert( 'a length inside a box is restated in pixels', str_contains( $length_content, '"top":"40px"' ) && str_contains( $length_content, '"right":"20px"' ) );
$assert( 'a length beside other tokens is restated in place', str_contains( $length_content, '"borderRadiusCustom":"0 0 0 40px"' ) );
$assert( 'a value with no rem is left alone', str_contains( $length_content, '"bottom":"0"' ) && str_contains( $length_content, 'var(--dst--x)' ) && str_contains( $length_content, '"imageTextRatio":"32%"' ) );
$assert( 'prose is not a length', str_contains( $length_content, 'Cut to a 4rem margin, by hand' ) );

$registry->forget_fixture( 'ds-blocks/dst-spacer' );

/*
 * `container-wide` is styled only under `.editor-styles-wrapper`. On the front
 * end it matches nothing, so the band fell through to WordPress's constrained
 * layout and the widest sections in the library rendered as an 850px column.
 */
$containers = new SBS_Importer_Block_Converter();
$wide_page  = $containers->page_to_content(
	array(
		'concept' => array(
			'page' => array(
				'sections' => array(
					array(
						'id'        => 'section-wide',
						'component' => 'ds-blocks/dst-wrapper',
						'layout'    => array( 'container' => 'wide' ),
						'children'  => array(),
					),
				),
			),
		),
	)
);
$wide_content = is_array( $wide_page ) ? (string) $wide_page['content'] : '';

$assert( 'the widest band asks for a container the front end renders', str_contains( $wide_content, '"dsContainer":"container"' ) );
$assert( 'the editor-only container class is gone', ! str_contains( $wide_content, 'container-wide' ) );

$registry->forget_fixture( 'ds-blocks/dst-wrapper' );

$failed = array_values( array_filter( $results, static fn( array $r ): bool => ! $r['passed'] ) );
echo wp_json_encode(
	array(
		'passed'           => empty( $failed ),
		'assertionsPassed' => count( $results ) - count( $failed ),
		'assertionsTotal'  => count( $results ),
		'failures'         => $failed,
	),
	JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
) . "\n";
exit( empty( $failed ) ? 0 : 1 );
