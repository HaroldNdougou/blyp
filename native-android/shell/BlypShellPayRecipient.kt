package com.haroldndougou.blyp.shell

import android.content.Context
import java.util.concurrent.Executors

object BlypShellPayRecipient {
  private val io = Executors.newSingleThreadExecutor()

  fun listForPicker(context: Context): List<BlypShellPayRuntime.RecipientOption> {
    val seen = LinkedHashSet<String>()
    val out = ArrayList<BlypShellPayRuntime.RecipientOption>()
    for (o in BlypShellPayRuntime.listCandidates(context.applicationContext)) {
      if (seen.add(o.accountId)) out.add(o)
    }
    return out
  }

  fun resolvePhoneAsync(
    context: Context,
    phoneRaw: String,
    onDone: (Result) -> Unit,
  ) {
    io.execute {
      val app = context.applicationContext
      val nine = BlypShellAuthClient.normalizePhoneDigits(phoneRaw)
      if (nine == null) {
        onDone(Result.InvalidPhone)
        return@execute
      }
      if (BlypShellSession.phone(app)?.replace(Regex("\\D"), "")?.takeLast(9) == nine) {
        onDone(Result.SelfPhone)
        return@execute
      }
      val lookup = BlypShellContactsClient.lookupPhones(app, listOf(nine))
      val accountId = lookup?.get(nine)?.trim().orEmpty()
      if (accountId.isEmpty()) {
        onDone(Result.NotOnBlyp)
        return@execute
      }
      val name =
        BlypTransactionStore.counterpartyNameForPhone(app, BlypShellSession.phone(app), nine)
          ?: formatPhoneLabel(nine)
      val option =
        BlypShellPayRuntime.RecipientOption(
          accountId = accountId,
          name = name,
          phoneDigits = nine,
        )
      BlypShellPayRuntime.applyRecipient(app, option)
      onDone(Result.Ok(option))
    }
  }

  sealed class Result {
    data class Ok(val option: BlypShellPayRuntime.RecipientOption) : Result()
    data object InvalidPhone : Result()
    data object NotOnBlyp : Result()
    data object SelfPhone : Result()
  }

  private fun formatPhoneLabel(nine: String): String {
    if (nine.length <= 3) return nine
    if (nine.length <= 6) return "${nine.take(3)} ${nine.drop(3)}"
    return "${nine.take(3)} ${nine.drop(3).take(3)} ${nine.drop(6)}"
  }
}
