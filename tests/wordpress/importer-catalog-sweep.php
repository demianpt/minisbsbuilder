<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once $root . '/wordpress-plugin/sbs-website-importer/includes/class-sbs-importer-block-contract.php';
require_once $root . '/wordpress-plugin/sbs-website-importer/includes/class-sbs-importer-block-converter.php';

$sections = array();
$pattern_ids = array();
foreach ( (array) ( $data['patterns'] ?? array() ) as $pattern ) {
	$tree = isset( $pattern['tree'] ) && is_array( $pattern['tree'] ) ? $pattern['tree'] : null;
	if ( ! $tree ) continue;
	$tree['pattern'] = $tree['pattern'] ?? ( $pattern['id'] ?? '' );
	$sections[] = $tree;
	$pattern_ids[] = (string) ( $pattern['id'] ?? '' );
}
$artifact = array(
	'schemaVersion' => 'dst-concept-export/1.0',
	'artifactType' => 'page',
	'concept' => array( 'page' => array( 'title' => 'Complete catalog sweep', 'sections' => $sections ) ),
);
$converter = new SBS_Importer_Block_Converter();
$result = $converter->page_to_content( $artifact );
$errors = array();
if ( is_wp_error( $result ) ) {
	$errors[] = $result->get_error_message();
	$result = array( 'content' => '', 'blocks' => 0, 'components' => array(), 'warnings' => array() );
}
if ( count( $sections ) !== 156 ) $errors[] = 'Expected 156 patterns, found ' . count( $sections );
if ( str_contains( $result['content'], 'sbs-figma-snapshot-image' ) ) $errors[] = 'Screenshot markup was serialized.';
if ( ! str_contains( $result['content'], '<!-- wp:ds-blocks/' ) ) $errors[] = 'No DST block comments were serialized.';
if ( count( $result['components'] ) < 28 ) $errors[] = 'Too few component types were serialized.';
$missing_patterns = array_values( array_filter( $pattern_ids, static fn( string $id ): bool => '' !== $id && ! str_contains( $result['content'], $id ) ) );
if ( $missing_patterns ) $errors[] = 'Pattern provenance missing for ' . count( $missing_patterns ) . ' patterns.';
$report = array(
	'passed' => empty( $errors ),
	'patterns' => count( $sections ),
	'blocks' => $result['blocks'],
	'componentTypes' => count( $result['components'] ),
	'components' => $result['components'],
	'bytes' => strlen( $result['content'] ),
	'warnings' => $result['warnings'],
	'missingPatternIds' => $missing_patterns,
	'errors' => $errors,
);
@mkdir( $root . '/test-results', 0777, true );
file_put_contents( $root . '/test-results/wordpress-catalog-sweep.json', json_encode( $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) );
echo json_encode( $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n";
exit( $report['passed'] ? 0 : 1 );
