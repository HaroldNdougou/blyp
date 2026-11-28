package com.haroldndougou.blyp.shell

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.haroldndougou.blyp.R

/** Liste des discussions. Les actus sont archivées et ne sont plus chargées. */
class MessagesInboxFragment : Fragment() {
  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?,
  ): View {
    val root = inflater.inflate(R.layout.blyp_shell_messages_inbox, container, false)
    if (childFragmentManager.findFragmentById(R.id.blyp_inbox_host) == null) {
      childFragmentManager
        .beginTransaction()
        .replace(R.id.blyp_inbox_host, MessagesListFragment())
        .commitNow()
    }
    return root
  }

  override fun onHiddenChanged(hidden: Boolean) {
    super.onHiddenChanged(hidden)
    (childFragmentManager.findFragmentById(R.id.blyp_inbox_host) as? MessagesListFragment)
      ?.onInboxVisibility(!hidden)
  }
}
