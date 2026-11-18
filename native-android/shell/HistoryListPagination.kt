package com.haroldndougou.blyp.shell

/** Pagination liste Historique (aligné RN `HISTORY_PAGE_SIZE = 10`). */
object HistoryListPagination {
  const val PAGE_SIZE = 10

  sealed class ListItem {
    data class Header(val title: String, val total: String? = null) : ListItem()
    data class Row(val row: ShellHistoryRow) : ListItem()
    object SeeMore : ListItem()
  }

  fun buildPage(full: List<ShellHistoryItem>, visibleTxLimit: Int): List<ListItem> {
    var txCount = 0
    val out = ArrayList<ListItem>()
    for (item in full) {
      when (item) {
        is ShellHistoryItem.Header -> out.add(ListItem.Header(item.title, item.total))
        is ShellHistoryItem.Row -> {
          if (txCount >= visibleTxLimit) break
          out.add(ListItem.Row(item.row))
          txCount++
        }
      }
    }
    val totalTx = full.count { it is ShellHistoryItem.Row }
    if (visibleTxLimit < totalTx) {
      out.add(ListItem.SeeMore)
    }
    return out
  }

  fun countTransactions(full: List<ShellHistoryItem>): Int =
    full.count { it is ShellHistoryItem.Row }
}
