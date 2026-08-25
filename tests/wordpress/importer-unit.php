<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

require_once $root . '/wordpress-plugin/sbs-website-importer/includes/class-sbs-importer-package.php';
require_once $root . '/wordpress-plugin/sbs-website-importer/includes/class-sbs-importer-block-contract.php';
require_once $root . '/wordpress-plugin/sbs-website-importer/includes/class-sbs-importer-block-converter.php';
require_once $root . '/wordpress-plugin/sbs-website-importer/includes/class-sbs-importer-theme.php';

$fixture = static function ( string $name ) use ( $root ): array {
	return json_decode( file_get_contents( $root . '/tests/fixtures/wordpress/' . $name ), true, 512, JSON_THROW_ON_ERROR );
};
$assertions = array();
$check = static function ( bool $condition, string $label ) use ( &$assertions ): void {
	$assertions[] = array( 'label' => $label, 'passed' => $condition );
	if ( ! $condition ) fwrite( STDERR, "FAIL: {$label}\n" );
};

$page = $fixture( 'page.json' );
$navigation = $fixture( 'navigation.json' );
$footer = $fixture( 'footer.json' );
$complete = $fixture( 'complete-project.json' );

$converter = new SBS_Importer_Block_Converter();
$page_result = $converter->page_to_content( $page );
$check( ! is_wp_error( $page_result ), 'page conversion succeeds' );
$page_content = is_wp_error( $page_result ) ? '' : $page_result['content'];
$check( str_contains( $page_content, '<!-- wp:ds-blocks/dst-banner' ), 'page contains native DST banner block comments' );
$check( str_contains( $page_content, 'bannerHeight' ), 'camelCase registered attributes are preserved' );
$check( ! str_contains( $page_content, '<!-- wp:core/' ), 'core block comments use canonical WordPress names' );
$check( ! str_contains( $page_content, 'sbs-figma-snapshot-image' ), 'page contains no screenshot module markup' );
$check( ( $page_result['blocks'] ?? 0 ) > 30, 'page conversion includes a complete nested block tree' );

$nav_result = $converter->navigation_to_content( $navigation, 123 );
$check( ! is_wp_error( $nav_result ), 'navigation conversion succeeds' );
$nav_content = is_wp_error( $nav_result ) ? '' : $nav_result['content'];
$check( str_contains( $nav_content, '<!-- wp:ds-blocks/dst-navigation' ), 'navigation becomes editable DST navigation blocks' );
// The theme's menu block reads a *location*, not an id: `menuSource: 'location'`
// with `menuLocation: 'primary-menu'`, which the importer has already pointed at
// the menu it built. Writing an id as well would add an attribute the block does
// not declare — the 1.0 importer did exactly that, and the header imported empty.
$check( str_contains( $nav_content, '"menuSource":"location"' ), 'the navigation menu is bound by theme location' );
$check( str_contains( $nav_content, '"menuLocation":"primary-menu"' ), 'the primary menu location is named' );
$check( ! str_contains( $nav_content, 'menuValue' ), 'no menu id is written where a location already binds' );
// Straight off the theme's own parts/header.html.
$check( str_contains( $nav_content, '<!-- wp:ds-blocks/dst-navigation-main' ), 'the navigation main row is a real block' );
$check( str_contains( $nav_content, '<!-- wp:ds-blocks/dst-navigation-mobile' ), 'the mobile navigation is a real block' );
$check( str_contains( $nav_content, '"navigationArea":"logo"' ), 'the navigation areas are named' );
$check( str_contains( $nav_content, '<!-- wp:ds-blocks/dst-site-logo' ), 'the site logo is the theme logo block' );
$check( ( $nav_result['blocks'] ?? 0 ) < ( $page_result['blocks'] ?? PHP_INT_MAX ), 'converter counters reset between artifacts' );

$footer_result = $converter->footer_to_content( $footer );
$check( ! is_wp_error( $footer_result ), 'footer conversion succeeds' );
$footer_content = is_wp_error( $footer_result ) ? '' : $footer_result['content'];
// The footer is the theme's own footer family now, not a wrapper standing in for
// it: three sections, each naming its area, exactly as parts/footer.html does.
$check( str_contains( $footer_content, '<!-- wp:ds-blocks/dst-footer ' ) || str_contains( $footer_content, '<!-- wp:ds-blocks/dst-footer\n' ) || str_contains( $footer_content, '<!-- wp:ds-blocks/dst-footer {' ), 'footer is the theme footer block' );
$check( str_contains( $footer_content, '<!-- wp:ds-blocks/dst-footer-section' ), 'footer rows are footer sections' );
$check( str_contains( $footer_content, '<!-- wp:ds-blocks/dst-footer-slot' ), 'footer columns are footer slots' );
$check( str_contains( $footer_content, '"sectionArea":"middle"' ), 'the middle row names its area' );
$check( str_contains( $footer_content, '<!-- wp:ds-blocks/dst-block-title' ), 'footer column headings are the theme title block' );
// `c-list-item` has listTitle/listSubTitle/heroText/icon and no link attribute at
// all, so a link column built from list items imports as unclickable words.
$check( str_contains( $footer_content, '<a href=' ), 'footer links are anchors that work' );
$check( str_contains( $footer_content, '<!-- wp:ds-blocks/dst-social-networks' ), 'the social row is the theme social block' );

/*
 * Paragraph copy has to arrive.
 *
 * The builder moves a paragraph's words onto the node — `node.text` — and the 1.0
 * converter only read `attributes.content` and `content.text`. So every paragraph
 * in every artifact imported blank: body copy, the footer description, the legal
 * line, the announcement bar. Nothing reported it, because an empty paragraph is
 * a perfectly valid block.
 */
$page_paragraphs = substr_count( $page_content, '<!-- wp:paragraph' ) + substr_count( $page_content, '<!-- wp:core/paragraph' );
$check( $page_paragraphs > 0, 'the page has paragraphs at all' );
$check( ! str_contains( $page_content, '<p></p>' ), 'no paragraph imports empty' );
$check( ! str_contains( $footer_content, '<p></p>' ), 'no footer paragraph imports empty' );

$warnings = array();
$split = SBS_Importer_Package::split_artifacts( $complete, $warnings );
$check( ! is_wp_error( $split ), 'complete-project JSON is accepted' );
$check( is_array( $split ) && array_keys( $split ) === array( 'page', 'navigation', 'footer' ), 'complete-project JSON splits into page, navigation, and footer' );

$css = SBS_Importer_Theme::build_css( (array) ( $page['concept']['theme'] ?? array() ) );
$check( str_contains( $css, '--dst--primary-color1:' ), 'theme CSS includes semantic DST colors' );
$check( str_contains( $css, '.editor-styles-wrapper' ), 'theme CSS is available in Gutenberg editor canvas' );
$check( ! preg_match( '/url\s*\(/i', $css ), 'theme CSS contains no external URL values' );
$check( str_contains( $css, '--sbs-grid-gap:' ) || empty( $page['concept']['theme']['designDialTokens'] ), 'resolved design-dial tokens are preserved when exported' );
$dial_css = SBS_Importer_Theme::build_css( array( 'designDialTokens' => array( 'gridGap' => '2.75rem', 'measure' => '68ch', 'motionDuration' => '0.42s', 'mediaSaturate' => '1.1' ) ) );
$check( str_contains( $dial_css, '--sbs-grid-gap:2.75rem;' ), 'WordPress consumes the exact exported grid-gap dial token' );
$check( str_contains( $dial_css, '--sbs-measure:68ch;' ), 'WordPress consumes the exact exported reading-measure dial token' );
$check( str_contains( $dial_css, '--sbs-motion-duration:0.42s;' ), 'WordPress consumes the exact exported motion dial token' );

$passed = count( array_filter( $assertions, static fn( array $a ): bool => $a['passed'] ) );
$report = array(
	'passed' => $passed === count( $assertions ),
	'assertionsPassed' => $passed,
	'assertionsTotal' => count( $assertions ),
	'pageBlocks' => is_wp_error( $page_result ) ? 0 : $page_result['blocks'],
	'navigationBlocks' => is_wp_error( $nav_result ) ? 0 : $nav_result['blocks'],
	'footerBlocks' => is_wp_error( $footer_result ) ? 0 : $footer_result['blocks'],
	'pageBytes' => strlen( $page_content ),
	'navigationBytes' => strlen( $nav_content ),
	'footerBytes' => strlen( $footer_content ),
	'themeCssBytes' => strlen( $css ),
	'assertions' => $assertions,
);
@mkdir( $root . '/test-results', 0777, true );
file_put_contents( $root . '/test-results/wordpress-importer-unit.json', json_encode( $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) );
echo json_encode( $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n";
exit( $report['passed'] ? 0 : 1 );
