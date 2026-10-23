extends Node2D
## A-reference terrain study: connected ground materials, layered banks and
## low botanical groups. All details are deterministic native 2D geometry.
## This is an art vignette, not a claim to reproduce the original simulation.

const Iso = preload("res://scripts/iso.gd")
var meadow: Texture2D = preload("res://assets/terrain-v2/meadow_summer.png")
var water: Texture2D = preload("res://assets/terrain-v2/water_open.png")
var clock := 0.0
var animate := true
var show_grid := false
var roads: Dictionary = {}
# The scene may override these after moving the vignette's houses.
# x/y are tile-space positions; size is tile-space width and depth.
var courtyards: Array[Rect2] = [Rect2(6.6, 5.7, 2.8, 3.3), Rect2(9.6, 4.7, 2.8, 3.3), Rect2(6.6, 8.7, 2.8, 3.3), Rect2(8.7, 11.7, 3.7, 4.0)]
var _redraw_timer := 0.0
var _river_min := 18.0
var _river_max := 21.0

func _ready() -> void:
	texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	_find_river()

func _find_river() -> void:
	for x in range(Iso.MAP_SIZE):
		if Iso.is_water(Vector2i(x, 0)):
			_river_min = float(x)
			break
	for x in range(Iso.MAP_SIZE - 1, -1, -1):
		if Iso.is_water(Vector2i(x, 0)):
			_river_max = float(x + 1)
			break

func _process(delta: float) -> void:
	if animate:
		clock += delta
		_redraw_timer += delta
		# Water is deliberately gentle; no need to rebuild static land at 60 Hz.
		if _redraw_timer >= 0.08:
			_redraw_timer = 0.0
			queue_redraw()

func _noise(value: float) -> float:
	return fposmod(sin(value * 12.9898 + 78.233) * 43758.5453, 1.0)

func textured_polygon(points: PackedVector2Array, texture: Texture2D, tint: Color, shift := Vector2.ZERO) -> void:
	var uvs := PackedVector2Array()
	for p in points:
		uvs.append((p + shift) / 512.0)
	draw_polygon(points, PackedColorArray([tint]), uvs, texture)

func _tile_rect(rect: Rect2) -> PackedVector2Array:
	return PackedVector2Array([Iso.project(rect.position), Iso.project(rect.position + Vector2(rect.size.x, 0)), Iso.project(rect.end), Iso.project(rect.position + Vector2(0, rect.size.y))])

func _yard_outline(rect: Rect2) -> PackedVector2Array:
	var x0 := rect.position.x
	var y0 := rect.position.y
	var x1 := rect.end.x
	var y1 := rect.end.y
	var points := PackedVector2Array()
	# Chamfered, gently irregular shoulders integrate the apron into grass,
	# rather than introducing another large perfectly rectangular platform.
	for tile in [Vector2(x0 + 0.16, y0), Vector2(lerpf(x0, x1, 0.54), y0 - 0.045), Vector2(x1 - 0.17, y0 + 0.02), Vector2(x1, y0 + 0.20), Vector2(x1 + 0.04, lerpf(y0, y1, 0.58)), Vector2(x1 - 0.09, y1 - 0.10), Vector2(lerpf(x0, x1, 0.49), y1 + 0.035), Vector2(x0 + 0.11, y1), Vector2(x0 - 0.025, y1 - 0.22), Vector2(x0 + 0.02, lerpf(y0, y1, 0.45)), Vector2(x0, y0 + 0.17)]:
		points.append(Iso.project(tile))
	return points

func _oval(center: Vector2, radius: Vector2, color: Color, phase := 0.0) -> void:
	var points := PackedVector2Array()
	for i in range(14):
		var angle := float(i) * TAU / 14.0
		var irregular := 0.94 + 0.06 * sin(float(i) * 3.0 + phase)
		points.append(center + Vector2(cos(angle) * radius.x, sin(angle) * radius.y) * irregular)
	draw_colored_polygon(points, color)

func _bank_x(y: float, right: bool) -> float:
	# Bank relief stays inside the collision-defined water strip. It is only a
	# shallow visual edge, never extra walkable ground or an invisible channel.
	var curve := 0.10 + 0.075 * sin(y * 0.74) + 0.045 * sin(y * 2.1)
	return _river_max - curve if right else _river_min + curve

func _bank_line(right: bool, inward: float, vertical := 0.0) -> PackedVector2Array:
	var points := PackedVector2Array()
	for step in range(49):
		var y := float(step) * 0.5
		var x := _bank_x(y, right) + (-inward if right else inward)
		points.append(Iso.project(Vector2(x, y)) + Vector2(0, vertical))
	return points

func _ribbon(a: PackedVector2Array, b: PackedVector2Array, color: Color) -> void:
	var polygon := a.duplicate()
	for i in range(b.size() - 1, -1, -1):
		polygon.append(b[i])
	draw_colored_polygon(polygon, color)

func _draw_land() -> void:
	# The art view fills the frame instead of presenting a floating diamond.
	# This background does not enlarge the 24x24 interactive world.
	var ground := PackedVector2Array([Vector2(-1800, -900), Vector2(1800, -900), Vector2(1800, 1700), Vector2(-1800, 1700)])
	textured_polygon(ground, meadow, Color("e3dda9"))
	# Broad, low-contrast meadow masses avoid a flat texture catalogue look.
	for i in range(95):
		var tile := Vector2(0.7 + _noise(i * 2.0) * 22.6, 0.7 + _noise(i * 2.0 + 1.0) * 22.6)
		if Iso.is_water(Vector2i(tile.floor())):
			continue
		var tint := Color(0.72, 0.68, 0.31, 0.08) if i % 3 == 0 else Color(0.25, 0.36, 0.18, 0.07)
		_oval(Iso.project(tile), Vector2(22 + _noise(i + 3) * 25, 10 + _noise(i + 7) * 12), tint, float(i))
	# A village shares continuous earthen aprons; buildings do not float on lawn.
	for yard in courtyards:
		draw_colored_polygon(_yard_outline(yard.grow(0.23)), Color(0.71, 0.67, 0.43, 0.15))
		draw_colored_polygon(_yard_outline(yard.grow(0.14)), Color(0.71, 0.67, 0.43, 0.24))
		draw_colored_polygon(_yard_outline(yard.grow(0.07)), Color(0.67, 0.64, 0.40, 0.38))
		draw_colored_polygon(_yard_outline(yard), Color("c8ba89"))
		var p := Iso.project(yard.end - Vector2(0.20, 0.13))
		_oval(p, Vector2(26, 9), Color(0.55, 0.49, 0.32, 0.13))
		# Small stone thresholds pick up upper-left light without a global grid.
		for step in range(5):
			var position := yard.position + Vector2(0.28 + float(step) * 0.48, yard.size.y - 0.38)
			if position.x > yard.end.x - 0.3:
				break
			var slab := _tile_rect(Rect2(position, Vector2(0.43, 0.27)))
			draw_colored_polygon(slab, Color("aaa998"))
			draw_line(slab[0], slab[1], Color("d7d0b3"), 1.0, true)
	for cell in roads:
		if Iso.is_water(cell):
			continue
		var tile := Vector2(cell)
		var points := Iso.footprint(cell, 1)
		draw_colored_polygon(points, Color("bdad7d"))
		var center := Iso.project(tile + Vector2(0.5, 0.5))
		# Join every adjacent road tile, adding a shoulder only on exposed edges.
		var adjacent := [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]
		for side in range(4):
			if not roads.has(cell + adjacent[side]):
				draw_line(points[side], points[(side + 1) % 4], Color("a5a46d"), 3.0, true)
		for fleck in range(3):
			var phase := float(cell.x * 100 + cell.y * 5 + fleck)
			var p := center + Vector2((_noise(phase) - 0.5) * 30, (_noise(phase + 1.0) - 0.5) * 13)
			draw_line(p, p + Vector2(2.5, -0.4), Color(0.55, 0.48, 0.29, 0.25), 1.0, true)

func _draw_water() -> void:
	var left := _bank_line(false, 0)
	var right := _bank_line(true, 0)
	var polygon := left.duplicate()
	for i in range(right.size() - 1, -1, -1):
		polygon.append(right[i])
	textured_polygon(polygon, water, Color("a7c5b7"), Vector2(clock * 1.2, clock * 0.3))
	# Five material bands separate damp earth, water contact, shallow jade and
	# the cool center. No white outline follows every tile or every shoreline.
	for bank_right in [false, true]:
		var outer := _bank_line(bank_right, -0.10)
		var edge := _bank_line(bank_right, 0.06, 3.0)
		_ribbon(outer, edge, Color("80795b"))
		_ribbon(_bank_line(bank_right, 0.02), _bank_line(bank_right, 0.22), Color(0.41, 0.58, 0.45, 0.55))
		_ribbon(_bank_line(bank_right, 0.22), _bank_line(bank_right, 0.51), Color(0.35, 0.60, 0.55, 0.28))
		_ribbon(_bank_line(bank_right, 0.51), _bank_line(bank_right, 0.79), Color(0.23, 0.48, 0.48, 0.12))
	for i in range(52):
		var y := 0.25 + _noise(i * 2.0) * 23.5
		var x := lerpf(_river_min + 0.35, _river_max - 0.35, _noise(i * 2.0 + 1.0))
		var p := Iso.project(Vector2(x, y))
		var length := 4.0 + _noise(float(i) + 5.0) * 12.0
		var alpha := 0.10 + 0.10 * (0.5 + 0.5 * sin(clock * 0.8 + i * 1.6))
		draw_polyline(PackedVector2Array([p + Vector2(-length, 1.2), p, p + Vector2(length * 0.45, 0.3)]), Color(0.82, 0.91, 0.83, alpha), 1.0, true)

func _rock(center: Vector2, size: float, seed_value: float) -> void:
	_oval(center + Vector2(size * 0.18, size * 0.13), Vector2(size * 0.78, size * 0.32), Color(0.20, 0.28, 0.19, 0.25), seed_value)
	var silhouette := PackedVector2Array([center + Vector2(-size * 0.65, 0), center + Vector2(-size * 0.45, -size * 0.48), center + Vector2(size * 0.10, -size * 0.62), center + Vector2(size * 0.62, -size * 0.23), center + Vector2(size * 0.65, size * 0.08), center + Vector2(size * 0.05, size * 0.25)])
	draw_colored_polygon(silhouette, Color("8e9789"))
	draw_colored_polygon(PackedVector2Array([silhouette[0], silhouette[1], silhouette[2], center + Vector2(0, -size * 0.1)]), Color("c6c7ac"))
	draw_colored_polygon(PackedVector2Array([silhouette[2], silhouette[3], silhouette[4], center + Vector2(0, -size * 0.1)]), Color("7a897b"))
	draw_line(silhouette[1], silhouette[2], Color(0.88, 0.88, 0.70, 0.65), 1.0, true)

func _grass(center: Vector2, scale_value: float, seed_value: float, flowers := false) -> void:
	_oval(center + Vector2(2, 1), Vector2(9, 3) * scale_value, Color(0.20, 0.28, 0.12, 0.18), seed_value)
	for blade in range(6):
		var spread := (float(blade) - 2.5) * 2.0 * scale_value
		var height := (5 + _noise(seed_value + blade) * 8) * scale_value
		var tip := center + Vector2(spread * 1.35, -height)
		var base := center + Vector2(spread * 0.35, 0)
		draw_line(base, tip, Color("7a8a3f") if blade % 2 == 0 else Color("a4ac52"), 1.4 * scale_value, true)
		if flowers and blade % 2 == 0:
			draw_circle(tip, 1.1 * scale_value, Color("dfd38b"))

func _draw_banks_and_meadow_details() -> void:
	for bank_right in [false, true]:
		for i in range(43):
			var y := 0.28 + float(i) * 0.55
			var n := _noise(i + (90 if bank_right else 0))
			var x := _bank_x(y, bank_right) + (-0.025 if bank_right else 0.025)
			var p := Iso.project(Vector2(x, y))
			# Different scale and gaps produce rock groups rather than a bead line.
			if i % 7 != 3:
				_rock(p + Vector2(n * 3, 0), 7 + n * 9, float(i))
			if i % 3 == 0:
				var land_x := x + (0.24 if bank_right else -0.24)
				_grass(Iso.project(Vector2(land_x, y + 0.15)), 0.9 + n * 0.35, i + 71, i % 2 == 0)
	# Low clusters frame edges and mark fallow meadow, leaving roads clear.
	for i in range(160):
		var tile := Vector2(0.6 + _noise(i * 2.0 + 300) * 22.8, 0.6 + _noise(i * 2.0 + 301) * 22.8)
		var cell := Vector2i(tile.floor())
		if Iso.is_water(cell) or roads.has(cell):
			continue
		var in_yard := false
		for yard in courtyards:
			if yard.grow(0.1).has_point(tile):
				in_yard = true
				break
		if not in_yard:
			_grass(Iso.project(tile), 0.45 + _noise(i + 100) * 0.50, i + 300, i % 7 == 0)

func _draw() -> void:
	_draw_land()
	_draw_water()
	_draw_banks_and_meadow_details()
	if show_grid:
		for y in range(Iso.MAP_SIZE):
			for x in range(Iso.MAP_SIZE):
				var points := Iso.footprint(Vector2i(x, y), 1)
				points.append(points[0])
				draw_polyline(points, Color(0.94, 0.94, 0.78, 0.15), 0.7)
