class_name TrialIso
extends RefCounted

const HALF_W := 32.0
const HALF_H := 16.0
const MAP_SIZE := 24

static func project(tile: Vector2) -> Vector2:
	return Vector2((tile.x - tile.y) * HALF_W, (tile.x + tile.y) * HALF_H)

static func unproject(point: Vector2) -> Vector2:
	return Vector2(point.x / 64.0 + point.y / 32.0, point.y / 32.0 - point.x / 64.0)

static func cell_at(point: Vector2) -> Vector2i:
	return Vector2i(unproject(point).floor())

static func footprint(cell: Vector2i, size: int) -> PackedVector2Array:
	var p := Vector2(cell)
	return PackedVector2Array([project(p), project(p + Vector2(size, 0)), project(p + Vector2(size, size)), project(p + Vector2(0, size))])

static func is_water(cell: Vector2i) -> bool:
	# A fixed river is deliberate: this is not the original world generator.
	return cell.x >= 18 and cell.x <= 20

static func in_bounds(cell: Vector2i) -> bool:
	return cell.x >= 0 and cell.y >= 0 and cell.x < MAP_SIZE and cell.y < MAP_SIZE
