<?php
/**
 * What a block will actually accept.
 *
 * `WP_Block_Type_Registry` answers this from `block.json` alone, and for these
 * blocks that answer is incomplete in a way that loses work. The theme adds a
 * second set of controls from JavaScript, through editor filters keyed on
 * `supports` flags: `dsGapControl` adds `dsPadding` and `dsMargin`,
 * `dsContainers` adds the container family, `dsEffects` adds `dsEffects`. None of
 * those names is in `block.json`, so PHP does not see them.
 *
 * The importer used the registry to decide whether it was allowed to write an
 * attribute. On a real site that meant every scroll effect, every band padding
 * and every class variant carried on a *node* rather than in `attributes` was
 * silently refused — and the same wrong answer was reported to the strategist as
 * "not registered by the active block package", for attributes the theme applies
 * on every page it renders.
 *
 * It could not be caught by the plugin's tests, either: the fixture registry is
 * built from the builder's own snapshot, which already lists the HOC names.
 *
 * So the rule here is deliberately one-sided: this class may never be the reason
 * a real setting is dropped. Where it cannot tell, it allows.
 *
 * @package SBS_Website_Importer
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SBS_Importer_Block_Contract {

	/**
	 * Editor HOCs, and the attributes each one adds when its flag is on.
	 *
	 * Read out of `build/blocks/hoc-components/*` in the theme. Keep in step with
	 * `FROM_SUPPORTS` in scripts/verify-catalog-against-theme.mjs, which is the
	 * check that would notice if the theme moved.
	 */
	private const FROM_SUPPORTS = array(
		'anchor'            => array( 'anchor' ),
		'dsContainers'      => array( 'dsContainer', 'dsContainerCustom', 'dsContainerSideGap', 'dsContainerSideGapMobile', 'dsContainerAlign' ),
		'dsGapControl'      => array( 'dsPadding', 'dsMargin' ),
		'dsEffects'         => array( 'dsEffects' ),
		'dsDeactivate'      => array( 'dsDeactivate' ),
		'dsClassVariants'   => array( 'classVariant' ),
		'dsClassList'       => array( 'class' ),
		'dsPatternSelector' => array( 'dsPatternAppliedPatternId' ),
	);

	/** Every HOC name, for the case where the flags cannot be read at all. */
	private const ALL_HOC_ATTRIBUTES = array(
		'anchor',
		'dsContainer',
		'dsContainerCustom',
		'dsContainerSideGap',
		'dsContainerSideGapMobile',
		'dsContainerAlign',
		'dsPadding',
		'dsMargin',
		'dsEffects',
		'dsDeactivate',
		'classVariant',
		'class',
		'dsPatternAppliedPatternId',
	);

	/** Keys WordPress itself carries on any block. */
	private const CORE_ATTRIBUTES = array( 'className', 'lock', 'metadata', 'style' );

	/** @var array<string,array<string,true>|null> block name => allowed set, or null when unknown */
	private array $cache = array();

	/**
	 * Whether this block accepts this attribute.
	 *
	 * An unregistered block returns true for everything: the block package may
	 * simply not be active on this site, and refusing would strip the page.
	 */
	public function accepts( string $block, string $attribute ): bool {
		$allowed = $this->allowed( $block );
		if ( null === $allowed ) {
			return true;
		}
		return isset( $allowed[ $attribute ] );
	}

	/**
	 * The attributes in this set that the block will ignore.
	 *
	 * @param array<string,mixed> $attrs
	 * @return array<int,string>
	 */
	public function unknown( string $block, array $attrs ): array {
		$allowed = $this->allowed( $block );
		if ( null === $allowed ) {
			return array();
		}
		$unknown = array();
		foreach ( array_keys( $attrs ) as $name ) {
			if ( ! isset( $allowed[ (string) $name ] ) ) {
				$unknown[] = (string) $name;
			}
		}
		sort( $unknown );
		return $unknown;
	}

	/** @return array<string,true>|null null when the block is not registered here */
	private function allowed( string $block ): ?array {
		if ( array_key_exists( $block, $this->cache ) ) {
			return $this->cache[ $block ];
		}
		$this->cache[ $block ] = $this->build( $block );
		return $this->cache[ $block ];
	}

	/** @return array<string,true>|null */
	private function build( string $block ): ?array {
		if ( ! class_exists( 'WP_Block_Type_Registry' ) ) {
			return null;
		}
		$registered = WP_Block_Type_Registry::get_instance()->get_registered( $block );
		if ( ! $registered ) {
			return null;
		}
		$declared = is_array( $registered->attributes ?? null ) ? $registered->attributes : array();
		if ( empty( $declared ) ) {
			return null;
		}

		$allowed = array();
		foreach ( array_keys( $declared ) as $name ) {
			$allowed[ (string) $name ] = true;
		}
		foreach ( self::CORE_ATTRIBUTES as $name ) {
			$allowed[ $name ] = true;
		}

		$supports = $registered->supports ?? null;
		if ( is_array( $supports ) ) {
			foreach ( self::FROM_SUPPORTS as $flag => $names ) {
				if ( empty( $supports[ $flag ] ) ) {
					continue;
				}
				foreach ( $names as $name ) {
					$allowed[ $name ] = true;
				}
			}
			$colour = $supports['color'] ?? null;
			if ( is_array( $colour ) ) {
				if ( false !== ( $colour['background'] ?? true ) ) {
					$allowed['backgroundColor'] = true;
				}
				if ( ! empty( $colour['gradients'] ) ) {
					$allowed['gradient'] = true;
				}
				if ( false !== ( $colour['text'] ?? true ) ) {
					$allowed['textColor'] = true;
				}
			}
			if ( ! empty( $supports['typography']['fontSize'] ) ) {
				$allowed['fontSize'] = true;
			}
			if ( isset( $supports['customClassName'] ) && false === $supports['customClassName'] ) {
				unset( $allowed['className'] );
			}
		} else {
			/*
			 * No flags to read — an older core, or a fixture registry that records
			 * attributes only. Allowing every HOC name is the safe direction: the
			 * cost is a setting the theme ignores, and the cost of the other
			 * choice is a page that lost its spacing and its motion.
			 */
			foreach ( self::ALL_HOC_ATTRIBUTES as $name ) {
				$allowed[ $name ] = true;
			}
		}

		return $allowed;
	}
}
