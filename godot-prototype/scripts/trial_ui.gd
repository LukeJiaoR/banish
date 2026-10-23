class_name TrialUI
extends RefCounted
## Ivory / jade, map-first UI based on docs/ui-reference/selected-a.png.
## This is a visual trial: no invented stocks, population, costs or production.

const PAPER := Color("f5f1df")
const PAPER_LIGHT := Color("fcf9ec")
const INK := Color("193f3b")
const MUTED := Color("61796b")
const JADE := Color("3e866f")
const LINE := Color("d8d9be")
const ART := {
	"house": "res://assets/a-style/house-a-v2-square-empty.png",
	"tree": "res://assets/a-style/tree-a-v1-broadleaf.png",
	"": "res://assets/a-style/storage-a-v2.png"
}
const NAMES := {"house": "木屋", "tree": "树木", "road": "土路", "": "河边小园"}
const COPY := {
	"house": "试摆一座木屋，观察屋顶、地基与前后层次。",
	"tree": "种一株树木，比较林间层次与建筑尺度。",
	"road": "铺一格土路，试着连接庭院与林间空地。",
	"": "沿河走走，看看庭院、林木与小动物。选择下方物件开始试摆。"
}

static func style(fill: Color, border: Color = LINE, radius: int = 14, inset: int = 12) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = fill
	box.border_color = border
	box.set_border_width_all(1)
	box.set_corner_radius_all(radius)
	box.content_margin_left = inset
	box.content_margin_right = inset
	box.content_margin_top = inset
	box.content_margin_bottom = inset
	box.shadow_color = Color(0.10, 0.22, 0.15, 0.12)
	box.shadow_size = 5
	box.shadow_offset = Vector2(0, 3)
	return box

static func label(copy: String, size: int = 17, color: Color = INK) -> Label:
	var node := Label.new()
	node.text = copy
	node.add_theme_font_size_override("font_size", size)
	node.add_theme_color_override("font_color", color)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node

static func button(copy: String, action: Callable, primary: bool = false) -> Button:
	var node := Button.new()
	node.text = copy
	node.custom_minimum_size.y = 40
	node.focus_mode = Control.FOCUS_NONE
	node.add_theme_stylebox_override("normal", style(JADE if primary else PAPER_LIGHT, Color("2c715d") if primary else LINE, 13, 9))
	node.add_theme_stylebox_override("hover", style(Color("4b967c") if primary else Color("ffffff"), JADE, 13, 9))
	node.add_theme_stylebox_override("pressed", style(Color("2b6855") if primary else Color("dcebd7"), JADE, 13, 9))
	node.add_theme_stylebox_override("disabled", style(Color("e1e4cf"), LINE, 13, 9))
	for state in ["font_color", "font_hover_color", "font_pressed_color"]:
		node.add_theme_color_override(state, PAPER_LIGHT if primary else INK)
	node.add_theme_color_override("font_disabled_color", Color("7c8a76"))
	node.pressed.connect(action)
	return node

static func road_art() -> Texture2D:
	# A small code-native UI glyph, not a generated building or new world asset.
	var svg := '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120" viewBox="0 0 180 120"><path d="M16 66L92 25l72 35-76 43z" fill="#c8d3a4" stroke="#a9b68a" stroke-width="2"/><path d="M61 91L38 80l75-42 22 11z" fill="#c4ad7c" stroke="#a68e61" stroke-width="2"/><path d="M51 81l75-40M65 88l74-40" stroke="#e0cc9c" stroke-width="2"/><path d="M37 61l-3-11m6 10 2-8m96 26 4-12m-2 13 7-7" fill="none" stroke="#819357" stroke-width="3" stroke-linecap="round"/></svg>'
	var image := Image.new()
	image.load_svg_from_string(svg)
	return ImageTexture.create_from_image(image)

static func image_view(texture: Texture2D, height: float) -> TextureRect:
	var node := TextureRect.new()
	node.texture = texture
	node.custom_minimum_size = Vector2(0, height)
	node.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	node.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node

static func build(main: Node2D) -> void:
	var canvas := CanvasLayer.new()
	canvas.name = "IvoryJadeUI"
	main.add_child(canvas)
	var root := Control.new()
	root.name = "TrialInterface"
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.add_child(root)
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var theme := Theme.new()
	theme.default_font = load("res://assets/fonts/jade-song.ttf")
	theme.default_font_size = 16
	root.theme = theme
	main.ui = root

	# Compact paper strip; unlike the reference, no fictitious resource counters.
	var header := PanelContainer.new()
	root.add_child(header)
	header.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	header.offset_left = 18
	header.offset_right = -18
	header.offset_top = 16
	header.offset_bottom = 78
	header.add_theme_stylebox_override("panel", style(PAPER, Color("d3d8b7"), 22, 10))
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 10)
	header.add_child(top)
	var brand := VBoxContainer.new()
	brand.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	brand.add_theme_constant_override("separation", 0)
	top.add_child(brand)
	brand.add_child(label("归园  ·  山水小景", 23))
	brand.add_child(label("Godot 视觉试验  /  原版保留", 12, MUTED))
	main.pause_button = button("暂停动画  Space", func(): main.set_paused(not main.paused))
	top.add_child(main.pause_button)
	top.add_child(button("网格  G", func():
		main.terrain.show_grid = not main.terrain.show_grid
		main.terrain.queue_redraw()))
	var reference := button("对照 A 图  R", func():
		if main.has_method("toggle_reference"):
			main.call("toggle_reference"))
	reference.tooltip_text = "查看 A 风格目标图；不把参考图当作运行画面"
	reference.visible = main.has_method("toggle_reference")
	top.add_child(reference)
	main.set_meta("trial_reference_button", reference)
	top.add_child(button("纯画面  H", func(): main.toggle_presentation()))

	# Right-side complete art / purpose / confirm. The map keeps most of the view.
	var side := PanelContainer.new()
	root.add_child(side)
	side.set_anchors_and_offsets_preset(Control.PRESET_RIGHT_WIDE)
	side.offset_left = -276
	side.offset_right = -18
	side.offset_top = 96
	side.offset_bottom = -18
	side.add_theme_stylebox_override("panel", style(PAPER, Color("cad2ac"), 22, 14))
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 10)
	side.add_child(content)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_child(scroll)
	var detail := VBoxContainer.new()
	detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	detail.add_theme_constant_override("separation", 8)
	scroll.add_child(detail)
	var caption := label("庭院试摆", 14, MUTED)
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	detail.add_child(caption)
	var art := image_view(load(ART["house"]), 168)
	main.preview_art = art
	detail.add_child(art)
	main.set_meta("trial_detail_art", art)
	var title := label("河边小园", 25)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	detail.add_child(title)
	main.set_meta("trial_detail_title", title)
	var divider := HSeparator.new()
	divider.add_theme_stylebox_override("separator", style(Color("d6d9bd"), Color("d6d9bd"), 0, 0))
	detail.add_child(divider)
	var purpose := label(COPY[""], 16)
	purpose.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	purpose.custom_minimum_size.y = 54
	detail.add_child(purpose)
	main.set_meta("trial_detail_copy", purpose)
	var choices := HBoxContainer.new()
	choices.add_theme_constant_override("separation", 7)
	detail.add_child(choices)
	var path_texture := road_art()
	main.set_meta("trial_road_texture", path_texture)
	main.tool_buttons.clear()
	for kind in ["house", "tree", "road"]:
		var key: String = kind
		var card := button("", func(): main.select_tool(key))
		card.toggle_mode = true
		card.custom_minimum_size = Vector2(68, 91)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.tooltip_text = COPY[kind]
		choices.add_child(card)
		var card_content := VBoxContainer.new()
		card.add_child(card_content)
		card_content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		card_content.offset_left = 5
		card_content.offset_right = -5
		card_content.offset_top = 5
		card_content.offset_bottom = -5
		card_content.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var texture: Texture2D = path_texture if kind == "road" else load(ART[kind])
		card_content.add_child(image_view(texture, 53))
		var card_title := label(NAMES[kind] + " " + str(main.tool_buttons.size() + 1), 14)
		card_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		card_content.add_child(card_title)
		main.tool_buttons[kind] = card

	# Keep confirmation reachable even on the 960x640 minimum window.
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 8)
	content.add_child(actions)
	var cancel := button("取消", func(): main.select_tool(""))
	cancel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	actions.add_child(cancel)
	main.confirm_button = button("确认试摆", func(): main.confirm_placement(), true)
	main.confirm_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main.confirm_button.tooltip_text = "Enter 确认 · 不消耗资源，不产生经营收益"
	actions.add_child(main.confirm_button)
	var undo := button("撤销本次试摆  Z", func(): main.undo_placement())
	undo.custom_minimum_size.y = 34
	content.add_child(undo)
	main.summary = label("", 13, MUTED)
	main.summary.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(main.summary)
	var scope := label("仅画面与操作试验\n居民、物流、经济与存档未移植", 12, MUTED)
	scope.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	content.add_child(scope)

	var bottom := PanelContainer.new()
	root.add_child(bottom)
	bottom.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	bottom.offset_left = 18
	bottom.offset_right = -294
	bottom.offset_top = -88
	bottom.offset_bottom = -18
	bottom.add_theme_stylebox_override("panel", style(Color(0.96, 0.95, 0.88, 0.94), LINE, 17, 10))
	var notes := VBoxContainer.new()
	notes.add_theme_constant_override("separation", 4)
	bottom.add_child(notes)
	main.status = label("", 15)
	main.status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	notes.add_child(main.status)
	var hint := label("中键 / WASD 移图 · 滚轮缩放 · Home 回中 · H 收起 / 显示界面", 12, MUTED)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	notes.add_child(hint)

static func refresh(main: Node2D) -> void:
	## Call LAST in main._refresh_ui(), after its existing text/counter update.
	if not main.has_meta("trial_detail_art"):
		return
	var kind: String = main.tool
	var art: TextureRect = main.get_meta("trial_detail_art")
	art.texture = main.get_meta("trial_road_texture") if kind == "road" else load(ART.get(kind, ART[""]))
	var title: Label = main.get_meta("trial_detail_title")
	title.text = NAMES.get(kind, NAMES[""])
	var purpose: Label = main.get_meta("trial_detail_copy")
	purpose.text = COPY.get(kind, COPY[""])
	for key in main.tool_buttons:
		var card: Button = main.tool_buttons[key]
		card.text = ""
		card.set_pressed_no_signal(key == kind)
	main.confirm_button.text = "确认试摆"
