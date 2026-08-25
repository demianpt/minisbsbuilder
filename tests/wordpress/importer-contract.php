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
					'layout'     => array( 'container' => 'wide', 'padding' => array( 'top' => 'large', 'bottom' => 'large' ) ),
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
$assert(
	'no warning is raised about attributes the theme applies',
	! (bool) preg_grep( '/dsPadding|dsEffects|dsContainer/', (array) $converted['warnings'] )
);

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
