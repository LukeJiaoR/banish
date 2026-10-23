extends Node2D

const Iso = preload("res://scripts/iso.gd")
const Animal = preload("res://scripts/animal.gd")
const Terrain = preload("res://scripts/terrain.gd")
const Details = preload("res://scripts/details.gd")
const Interface = preload("res://scripts/trial_ui.gd")
const HOME_POSITION := Vector2(-40, 380)
const HOME_ZOOM := 1.5
const TOOL_NAMES := {"": "浏览", "house": "木屋", "tree": "树木", "road": "土路"}
var terrain: Node2D
var shadows: Node2D
var entities: Node2D
var preview_art: TextureRect
var reference_layer: CanvasLayer
var reference_visible := false
var reference_previous_pause := false
var presentation := false
var presentation_previous_grid := false
var camera: Camera2D
var animals: Array[Node2D] = []
var placed: Array[Dictionary] = []
var occupied: Dictionary = {}
var reserved: Dictionary = {}
var tool := ""
var hover_cell := Vector2i(-99, -99)
var pending := Vector2i(-99, -99)
var paused := false
var dragging := false
var ui: Control
var status: Label
var summary: Label
var confirm_button: Button
var pause_button: Button
var tool_buttons: Dictionary = {}
var status_message := "选择建造工具，点选地块，再确认放置。"

func _ready() -> void:
	terrain = Terrain.new()
	terrain.show_behind_parent = true
	add_child(terrain)
	shadows = Node2D.new()
	shadows.show_behind_parent = true
	add_child(shadows)
	entities = Node2D.new()
	entities.show_behind_parent = true
	entities.y_sort_enabled = true
	add_child(entities)
	camera = Camera2D.new()
	camera.position = HOME_POSITION
	camera.zoom = Vector2.ONE * HOME_ZOOM
	add_child(camera)
	_make_ui()
	reset_scene()

func reset_scene() -> void:
	for container in [entities, shadows]:
		for child in container.get_children():
			container.remove_child(child)
			child.queue_free()
	animals.clear()
	placed.clear()
	occupied.clear()
	reserved.clear()
	terrain.roads.clear()
	# The A study is composed as a village, not a sheet of isolated sprites.
	for area in [Rect2i(2, 15, 2, 6), Rect2i(13, 8, 4, 2), Rect2i(15, 11, 2, 4), Rect2i(10, 15, 3, 2), Rect2i(8, 17, 3, 3), Rect2i(4, 17, 3, 3)]:
		for x in range(area.position.x, area.end.x):
			for y in range(area.position.y, area.end.y):
				reserved[Vector2i(x, y)] = true
	for p in [Vector2i(6, 4), Vector2i(9, 3), Vector2i(5, 8), Vector2i(9, 7), Vector2i(13, 5), Vector2i(7, 13), Vector2i(13, 16)]:
		_add_object("house", p, false)
	_add_object("storage", Vector2i(11, 10), false)
	_add_object("workshop", Vector2i(4, 11), false)
	terrain.courtyards.assign([Rect2(5.6, 3.7, 2.8, 3.3), Rect2(8.7, 2.7, 2.8, 3.4), Rect2(4.7, 7.7, 3.0, 3.4), Rect2(8.7, 6.7, 3.0, 3.5), Rect2(12.7, 4.7, 2.9, 3.3), Rect2(6.7, 12.7, 3.1, 3.4), Rect2(12.7, 15.7, 3.2, 3.5), Rect2(10.5, 9.7, 4.2, 4.0), Rect2(3.6, 10.7, 4.0, 4.0)])
	for segment in [[Vector2i(8, 2), Vector2i(8, 12)], [Vector2i(8, 10), Vector2i(17, 10)], [Vector2i(7, 15), Vector2i(17, 15)], [Vector2i(12, 4), Vector2i(12, 9)], [Vector2i(7, 16), Vector2i(7, 21)]]:
		var start: Vector2i = segment[0]
		var end: Vector2i = segment[1]
		var steps := maxi(absi(end.x - start.x), absi(end.y - start.y))
		for i in range(steps + 1):
			var cell := Vector2i(Vector2(start).lerp(Vector2(end), float(i) / maxi(1, steps)).round())
			if not occupied.has(cell) and not reserved.has(cell):
				terrain.roads[cell] = true
	# Rear canopy and foreground framing: clustered age/height changes, not
	# regular spacing or per-frame random decorative growth.
	var tree_points := [Vector2i(2, 2), Vector2i(3, 2), Vector2i(4, 1), Vector2i(5, 2), Vector2i(7, 1), Vector2i(9, 1), Vector2i(11, 1), Vector2i(12, 2), Vector2i(14, 2), Vector2i(15, 3), Vector2i(16, 2), Vector2i(2, 4), Vector2i(3, 5), Vector2i(2, 7), Vector2i(3, 8), Vector2i(1, 10), Vector2i(2, 12), Vector2i(4, 14), Vector2i(6, 16), Vector2i(8, 21), Vector2i(10, 22), Vector2i(12, 21), Vector2i(14, 21), Vector2i(16, 22), Vector2i(17, 20), Vector2i(17, 15), Vector2i(17, 7), Vector2i(17, 4), Vector2i(22, 3), Vector2i(22, 6), Vector2i(22, 9), Vector2i(22, 14), Vector2i(22, 17), Vector2i(22, 20), Vector2i(21, 22)]
	for i in range(tree_points.size()):
		var p: Vector2i = tree_points[i]
		if not occupied.has(p) and not reserved.has(p) and not terrain.roads.has(p):
			var type := "willow" if p.x >= 17 else ("young" if i % 5 == 1 else "tree")
			_add_object(type, p, false)
	for p in [Vector2(4.4, 17.5), Vector2(5.8, 17.4), Vector2(4.5, 19.0), Vector2(6.0, 19.1)]:
		_add_prop("props/orchard_leafy", p, 49.0, Vector2(64, 117), false)
	for p in [Vector2(17.6, 3.2), Vector2(17.5, 5.5), Vector2(17.7, 8.3), Vector2(17.6, 13.0), Vector2(17.5, 17.9), Vector2(17.6, 21.7), Vector2(21.1, 8.0), Vector2(21.1, 15.4), Vector2(21.2, 20.0)]:
		_add_prop("a-style/bank-sedge-a-v1", p, 27.0, Vector2(128, 196), false)
	for p in [Vector2(7.4, 7.0), Vector2(11.1, 6.1), Vector2(15.5, 7.2), Vector2(9.5, 15.5), Vector2(14.5, 13.6)]:
		_add_prop("citizens/adult_idle", p, 10.5, Vector2(15.5, 71), false)
	_add_detail("garden", Vector2(8, 17), Vector2(11, 20))
	for segment in [[Vector2(4, 17), Vector2(4, 20)], [Vector2(4, 20), Vector2(6.7, 20)], [Vector2(8, 20), Vector2(11, 20)], [Vector2(11, 17), Vector2(11, 20)], [Vector2(5, 10.4), Vector2(7.6, 10.4)], [Vector2(13, 7.4), Vector2(15.5, 7.4)]]:
		_add_detail("fence", segment[0], segment[1])
	_add_detail("bridge", Vector2(17.7, 10.4), Vector2(21.2, 10.4))
	_spawn_animal("deer", [Vector2(2.2, 15.3), Vector2(3.5, 15.3), Vector2(3.5, 19.8), Vector2(2.2, 19.8)], 0.0)
	_spawn_animal("deer", [Vector2(2.5, 16), Vector2(3.2, 16), Vector2(3.2, 19), Vector2(2.5, 19)], 6.0)
	_spawn_animal("sheep", [Vector2(13.3, 8.3), Vector2(16.5, 8.3), Vector2(16.5, 9.5), Vector2(13.3, 9.5)], 1.2)
	_spawn_animal("sheep", [Vector2(14.2, 8.6), Vector2(16, 8.6), Vector2(16, 9.4), Vector2(14.2, 9.4)], 7.0)
	_spawn_animal("cattle", [Vector2(15.3, 11.3), Vector2(16.6, 11.3), Vector2(16.6, 14.5), Vector2(15.3, 14.5)], 2.0)
	_spawn_animal("chicken", [Vector2(10.3, 15.2), Vector2(12.7, 15.2), Vector2(12.7, 16.6), Vector2(10.3, 16.6)], 4.0)
	_spawn_animal("chicken", [Vector2(11.1, 15.4), Vector2(12.4, 15.4), Vector2(12.4, 16.4), Vector2(11.1, 16.4)], 9.0)
	set_paused(false)
	select_tool("")
	camera.position = HOME_POSITION
	camera.zoom = Vector2.ONE * HOME_ZOOM
	status_message = "A 图美术对照试验 · 院落 / 曲岸 / 层叠植被 · R 看参考，H 纯画面"
	_refresh_ui()
	terrain.queue_redraw()

func _add_detail(kind: String, a: Vector2, b: Vector2) -> void:
	var detail := Details.new()
	detail.kind = kind
	detail.start = a
	detail.finish = b
	detail.position = Iso.project((a + b) * 0.5)
	if kind == "garden":
		shadows.add_child(detail)
	else:
		entities.add_child(detail)

func _add_prop(asset: String, tile: Vector2, width: float, anchor: Vector2, blocks: bool) -> void:
	var node := Sprite2D.new()
	node.texture = load("res://assets/" + asset + ".png")
	node.position = Iso.project(tile)
	node.centered = false
	node.offset = -anchor
	node.scale = Vector2.ONE * width / node.texture.get_width()
	entities.add_child(node)
	if blocks:
		occupied[Vector2i(tile.floor())] = node

func _spawn_animal(kind: String, points: Array[Vector2], phase: float) -> void:
	var animal := Animal.new()
	animal.setup(kind, points, phase)
	entities.add_child(animal)
	animals.append(animal)

func _add_object(kind: String, cell: Vector2i, user_placed: bool) -> void:
	var anchor := Vector2(820, 984)
	var scale_factor := 88.0 / 960.0
	var asset := "tree-a-v1-broadleaf"
	var size := 1
	var foot := Iso.project(Vector2(cell) + Vector2(0.5, 0.5))
	var sort_offset := 0.0
	if kind == "house":
		asset = "house-a-v2-square-empty"
		anchor = Vector2(768, 975)
		scale_factor = 128.0 / 1056.0
		size = 2
		sort_offset = 40.0
	elif kind == "storage":
		asset = "storage-a-v2"
		anchor = Vector2(400.535885, 706.755981)
		scale_factor = 197.76 / 754.5263158
		size = 3
		sort_offset = 40.0
	elif kind == "workshop":
		asset = "woodcutter-a-idle"
		anchor = Vector2(543.125, 657.9375)
		scale_factor = 186.0 / 754.1875
		size = 3
		sort_offset = 40.0
	elif kind == "young":
		asset = "tree-a-v2-broadleaf-young"
		anchor = Vector2(199.043, 370.526)
		scale_factor = 57.0 / 363.177
	elif kind == "willow":
		asset = "tree-a-v1-willow"
		anchor = Vector2(770, 990)
		scale_factor = 92.0 / 980.0
	if size > 1:
		foot = Iso.project(Vector2(cell) + Vector2(size, size))
	var node := Node2D.new()
	node.position = foot - Vector2(0, sort_offset)
	var sprite := Sprite2D.new()
	sprite.texture = load("res://assets/a-style/" + asset + ".png")
	sprite.centered = false
	sprite.offset = -anchor
	sprite.scale = Vector2.ONE * scale_factor
	sprite.position.y = sort_offset
	node.add_child(sprite)
	entities.add_child(node)
	# Alpha-silhouette shadows are rendered on a separate ground layer, never
	# over another actor's roof. The existing source image is not modified.
	var shadow := Sprite2D.new()
	shadow.texture = sprite.texture
	shadow.centered = false
	shadow.offset = -anchor
	shadow.position = foot + Vector2(12, 3)
	shadow.scale = Vector2(scale_factor * 0.98, scale_factor * 0.26)
	shadow.skew = -0.72
	shadow.modulate = Color(0.12, 0.21, 0.12, 0.18)
	shadows.add_child(shadow)
	node.set_meta("shadow", shadow)
	for x in range(cell.x, cell.x + size):
		for y in range(cell.y, cell.y + size):
			occupied[Vector2i(x, y)] = node
	if user_placed:
		placed.append({"kind": kind, "cell": cell, "size": size, "node": node})

func placement_error(kind: String, cell: Vector2i) -> String:
	if not TOOL_NAMES.has(kind) or kind.is_empty():
		return "请先选择工具"
	var size := 2 if kind == "house" else 1
	for x in range(cell.x, cell.x + size):
		for y in range(cell.y, cell.y + size):
			var point := Vector2i(x, y)
			if not Iso.in_bounds(point):
				return "超出试验地图"
			if Iso.is_water(point):
				return "水面不能放置"
			if occupied.has(point):
				return "已有建筑或树木"
			if reserved.has(point):
				return "保留动物活动区，不能放置"
			if terrain.roads.has(point):
				return "已有道路"
	return ""

func stage_placement(cell: Vector2i) -> bool:
	pending = cell
	var error := placement_error(tool, cell)
	status_message = ("待确认：" + TOOL_NAMES[tool] + " · " + str(cell)) if error.is_empty() else error
	_refresh_ui()
	queue_redraw()
	return error.is_empty()

func confirm_placement() -> bool:
	if pending == Vector2i(-99, -99) or not placement_error(tool, pending).is_empty():
		return false
	if tool == "road":
		terrain.roads[pending] = true
		placed.append({"kind": tool, "cell": pending, "size": 1})
	else:
		_add_object(tool, pending, true)
	status_message = "已放置" + TOOL_NAMES[tool] + "；这是即时美术试摆，不代表施工或产出。"
	pending = Vector2i(-99, -99)
	_refresh_ui()
	terrain.queue_redraw()
	queue_redraw()
	return true

func undo_placement() -> void:
	if placed.is_empty():
		status_message = "没有本次试摆可以撤销；预置场景保持不动。"
	else:
		var entry: Dictionary = placed.pop_back()
		if entry.kind == "road":
			terrain.roads.erase(entry.cell)
		else:
			for x in range(entry.cell.x, entry.cell.x + entry.size):
				for y in range(entry.cell.y, entry.cell.y + entry.size):
					occupied.erase(Vector2i(x, y))
			var shadow: Node = entry.node.get_meta("shadow")
			shadows.remove_child(shadow)
			shadow.queue_free()
			entities.remove_child(entry.node)
			entry.node.queue_free()
		status_message = "已撤销最后一次试摆。"
	pending = Vector2i(-99, -99)
	_refresh_ui()
	terrain.queue_redraw()
	queue_redraw()

func select_tool(value: String) -> void:
	tool = value
	pending = Vector2i(-99, -99)
	status_message = "浏览模式" if value.is_empty() else ("试摆" + TOOL_NAMES[value] + "：点击地块预览，再点确认。")
	_refresh_ui()
	queue_redraw()

func set_paused(value: bool) -> void:
	paused = value
	terrain.animate = not value
	for animal in animals:
		animal.active = not value
	if pause_button:
		pause_button.text = "继续动画  Space" if paused else "暂停动画  Space"

func zoom_by(factor: float) -> void:
	var before := get_global_mouse_position()
	var amount := clampf(camera.zoom.x * factor, 0.65, 2.4)
	camera.zoom = Vector2.ONE * amount
	camera.force_update_scroll()
	camera.position += before - get_global_mouse_position()
	_clamp_camera()
	camera.force_update_scroll()

func _clamp_camera() -> void:
	camera.position.x = clampf(camera.position.x, -680, 680)
	camera.position.y = clampf(camera.position.y, 0, 760)

func _process(delta: float) -> void:
	var direction := Vector2(float(Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT)) - float(Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT)), float(Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN)) - float(Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP)))
	if not reference_visible and not direction.is_zero_approx():
		camera.position += direction.normalized() * 420.0 * delta / camera.zoom.x
		_clamp_camera()
	hover_cell = Iso.cell_at(get_global_mouse_position())
	queue_redraw()

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		dragging = false

func _input(event: InputEvent) -> void:
	# Finish an existing drag even when its release lands on UI.
	if event is InputEventMouseButton and not event.pressed and event.button_index == MOUSE_BUTTON_MIDDLE:
		dragging = false
	if event is InputEventMouseMotion and dragging:
		camera.position -= event.relative / camera.zoom
		_clamp_camera()
		get_viewport().set_input_as_handled()

func _unhandled_input(event: InputEvent) -> void:
	if reference_visible:
		if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode in [KEY_R, KEY_ESCAPE]:
			toggle_reference()
		return
	if presentation and event is InputEventKey and event.physical_keycode in [KEY_1, KEY_2, KEY_3, KEY_ENTER, KEY_Z, KEY_G]:
		return
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_MIDDLE:
			dragging = event.pressed
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
			zoom_by(1.12)
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			zoom_by(1.0 / 1.12)
		elif event.pressed and event.button_index == MOUSE_BUTTON_RIGHT:
			select_tool("")
		elif event.pressed and event.button_index == MOUSE_BUTTON_LEFT and not tool.is_empty():
			stage_placement(Iso.cell_at(get_global_mouse_position()))
	if event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_1: select_tool("house")
			KEY_2: select_tool("tree")
			KEY_3: select_tool("road")
			KEY_ESCAPE:
				if reference_visible:
					toggle_reference()
				else:
					select_tool("")
			KEY_R: toggle_reference()
			KEY_H: toggle_presentation()
			KEY_ENTER: confirm_placement()
			KEY_SPACE: set_paused(not paused)
			KEY_Z: undo_placement()
			KEY_G:
				terrain.show_grid = not terrain.show_grid
				terrain.queue_redraw()
			KEY_HOME:
				camera.position = HOME_POSITION
				camera.zoom = Vector2.ONE * HOME_ZOOM

func toggle_presentation() -> void:
	if not presentation:
		select_tool("")
		presentation_previous_grid = terrain.show_grid
		terrain.show_grid = false
	else:
		terrain.show_grid = presentation_previous_grid
	terrain.queue_redraw()
	presentation = not presentation
	ui.visible = not presentation

func toggle_reference() -> void:
	if not reference_layer:
		reference_layer = CanvasLayer.new()
		reference_layer.layer = 20
		add_child(reference_layer)
		var backdrop := ColorRect.new()
		backdrop.color = Color(0.06, 0.13, 0.1, 0.97)
		backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		reference_layer.add_child(backdrop)
		var picture := TextureRect.new()
		picture.texture = load("res://reference/selected-a.png")
		picture.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		picture.offset_left = 20
		picture.offset_top = 52
		picture.offset_right = -20
		picture.offset_bottom = -20
		picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
		backdrop.add_child(picture)
		var title := Label.new()
		title.text = "A 原始设计参考图 · 不是 Godot 运行截图  /  R 或 Esc 返回"
		title.add_theme_font_override("font", load("res://assets/fonts/jade-song.ttf"))
		title.add_theme_font_size_override("font_size", 21)
		title.position = Vector2(24, 12)
		backdrop.add_child(title)
	if not reference_visible:
		reference_previous_pause = paused
		set_paused(true)
	else:
		set_paused(reference_previous_pause)
	reference_visible = not reference_visible
	reference_layer.visible = reference_visible
	dragging = false

func _draw() -> void:
	if tool.is_empty():
		return
	var cell := pending if pending != Vector2i(-99, -99) else hover_cell
	if not Iso.in_bounds(cell):
		return
	var legal := placement_error(tool, cell).is_empty()
	var points := Iso.footprint(cell, 2 if tool == "house" else 1)
	var tint := Color(0.72, 0.92, 0.65, 0.35) if legal else Color(0.9, 0.36, 0.28, 0.4)
	draw_colored_polygon(points, tint)
	points.append(points[0])
	draw_polyline(points, Color("e4f4bf") if legal else Color("f6a88e"), 2.0, true)

func _make_ui() -> void:
	Interface.build(self)

func _refresh_ui() -> void:
	if not status:
		return
	status.text = status_message
	confirm_button.disabled = pending == Vector2i(-99, -99) or not placement_error(tool, pending).is_empty()
	for kind in tool_buttons:
		tool_buttons[kind].text = ("●  " if tool == kind else "") + TOOL_NAMES[kind] + ("  1" if kind == "house" else ("  2" if kind == "tree" else "  3"))
	summary.text = "试摆 %d 件  ·  7 只动物\n不保存；关闭即还原" % placed.size()

	Interface.refresh(self)
