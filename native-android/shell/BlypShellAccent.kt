package com.haroldndougou.blyp.shell

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.res.Resources
import android.graphics.Color
import android.util.TypedValue
import com.haroldndougou.blyp.R

/** Couleur d’accent choisie dans les réglages (vert Blyp par défaut). */
object BlypShellAccent {
  const val PREFS = "blyp_shell_accent"
  const val KEY = "skin"

  enum class Skin(
    val id: String,
    val labelFr: String,
    val labelEn: String,
    val accent: Int,
    val accentDark: Int,
    val accentSoft: Int,
    val depositBg: Int,
    val depositBorder: Int,
  ) {
    GREEN(
      "green",
      "Vert",
      "Green",
      Color.parseColor("#5DC705"),
      Color.parseColor("#4BB004"),
      Color.parseColor("#1A5DC705"),
      Color.parseColor("#F4FFF0"),
      Color.parseColor("#E0F5D5"),
    ),
    ROSE(
      "rose",
      "Rose",
      "Rose",
      Color.parseColor("#FF4D8D"),
      Color.parseColor("#E63575"),
      Color.parseColor("#1AFF4D8D"),
      Color.parseColor("#FFF0F5"),
      Color.parseColor("#FFD6E5"),
    ),
    GOLD(
      "gold",
      "Or",
      "Gold",
      Color.parseColor("#D4A017"),
      Color.parseColor("#B8860B"),
      Color.parseColor("#1AD4A017"),
      Color.parseColor("#FFF8E7"),
      Color.parseColor("#F0E0B8"),
    ),
    OCEAN(
      "ocean",
      "Océan",
      "Ocean",
      Color.parseColor("#0A84FF"),
      Color.parseColor("#0066CC"),
      Color.parseColor("#1A0A84FF"),
      Color.parseColor("#EAF4FF"),
      Color.parseColor("#CDE4FF"),
    ),
    VIOLET(
      "violet",
      "Violet",
      "Violet",
      Color.parseColor("#AF52DE"),
      Color.parseColor("#8E3CB8"),
      Color.parseColor("#1AAF52DE"),
      Color.parseColor("#F8F0FF"),
      Color.parseColor("#E8D4F7"),
    ),
    CORAL(
      "coral",
      "Corail",
      "Coral",
      Color.parseColor("#FF6B4A"),
      Color.parseColor("#E84E2E"),
      Color.parseColor("#1AFF6B4A"),
      Color.parseColor("#FFF2EE"),
      Color.parseColor("#FFD9CF"),
    ),
    MINT(
      "mint",
      "Menthe",
      "Mint",
      Color.parseColor("#00C7B1"),
      Color.parseColor("#00A896"),
      Color.parseColor("#1A00C7B1"),
      Color.parseColor("#E8FFFB"),
      Color.parseColor("#C5F3EC"),
    ),
    INDIGO(
      "indigo",
      "Indigo",
      "Indigo",
      Color.parseColor("#5E6AD2"),
      Color.parseColor("#4A54B8"),
      Color.parseColor("#1A5E6AD2"),
      Color.parseColor("#F0F1FF"),
      Color.parseColor("#D8DBF5"),
    ),
  }

  @Volatile private var cached: Skin? = null
  @Volatile private var wrapped: AccentResources? = null

  fun all(): List<Skin> = Skin.entries

  fun current(context: Context): Skin {
    cached?.let { return it }
    val id =
      context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY, Skin.GREEN.id)
        .orEmpty()
    return (Skin.entries.firstOrNull { it.id == id } ?: Skin.GREEN).also { cached = it }
  }

  fun set(context: Context, skin: Skin) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, skin.id)
      .apply()
    cached = skin
    wrapped = null
    val app = context.applicationContext
    app.startActivity(
      Intent(app, BlypNativeShellActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      },
    )
    (context as? Activity)?.finish()
  }

  fun wrapContext(base: Context): Context {
    val skin = current(base)
    if (skin == Skin.GREEN) return base
    return object : ContextWrapper(base) {
      private val res: Resources by lazy { wrapResources(base.resources, base) }

      override fun getResources(): Resources = res
    }
  }

  fun wrapResources(base: Resources, context: Context): Resources {
    val skin = current(context)
    if (skin == Skin.GREEN) return base
    val night =
      (base.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
        android.content.res.Configuration.UI_MODE_NIGHT_YES
    val hit = wrapped
    if (hit != null && hit.skin === skin && hit.night == night && hit.sameBase(base)) return hit
    return AccentResources(base, skin, night).also { wrapped = it }
  }

  fun invalidate() {
    cached = null
    wrapped = null
  }

  class AccentResources(
    private val base: Resources,
    val skin: Skin,
    val night: Boolean,
  ) : Resources(base.assets, base.displayMetrics, base.configuration) {
    init {
      try {
        val field = Resources::class.java.getDeclaredField("mResourcesImpl")
        field.isAccessible = true
        field.set(this, field.get(base))
      } catch (_: Exception) {
      }
    }

    fun sameBase(other: Resources): Boolean = base === other

    @Deprecated("Deprecated in Java")
    override fun getColor(id: Int): Int = mapped(id) ?: base.getColor(id)

    override fun getColor(id: Int, theme: Theme?): Int = mapped(id) ?: base.getColor(id, theme)

    override fun getValue(id: Int, outValue: TypedValue, resolveRefs: Boolean) {
      if (put(id, outValue)) return
      base.getValue(id, outValue, resolveRefs)
    }

    override fun getValueForDensity(
      id: Int,
      density: Int,
      outValue: TypedValue,
      resolveRefs: Boolean,
    ) {
      if (put(id, outValue)) return
      base.getValueForDensity(id, density, outValue, resolveRefs)
    }

    private fun mapped(id: Int): Int? =
      when (id) {
        R.color.blyp_shell_accent -> skin.accent
        R.color.blyp_shell_accent_dark -> skin.accentDark
        R.color.blyp_shell_accent_soft ->
          if (night) (skin.accent and 0x00FFFFFF) or 0x33000000 else skin.accentSoft
        R.color.blyp_shell_bubble_mine -> skin.accent
        R.color.blyp_shell_deposit_bg ->
          if (night) (skin.accent and 0x00FFFFFF) or 0x22000000 else skin.depositBg
        R.color.blyp_shell_deposit_border ->
          if (night) (skin.accent and 0x00FFFFFF) or 0x33000000 else skin.depositBorder
        R.color.blyp_shell_avatar_text -> skin.accentDark
        R.color.blyp_shell_success_amount -> skin.accentDark
        else -> null
      }

    private fun put(id: Int, out: TypedValue): Boolean {
      val color = mapped(id) ?: return false
      out.type = TypedValue.TYPE_INT_COLOR_ARGB8
      out.data = color
      return true
    }
  }
}
