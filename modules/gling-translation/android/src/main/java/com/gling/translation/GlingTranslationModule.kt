package com.gling.translation

import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.CancellationException

class GlingTranslationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GlingTranslation")

    AsyncFunction("translate") Coroutine { texts: List<String>, target: String ->
      require(target in listOf("ko", "en") && texts.isNotEmpty() && texts.size <= 256 && texts.sumOf { it.length } <= 20000)
      val options = TranslatorOptions.Builder()
        .setSourceLanguage(if (target == "ko") TranslateLanguage.ENGLISH else TranslateLanguage.KOREAN)
        .setTargetLanguage(if (target == "ko") TranslateLanguage.KOREAN else TranslateLanguage.ENGLISH)
        .build()
      val translator = Translation.getClient(options)
      try {
        try { awaitTask(translator.downloadModelIfNeeded(DownloadConditions.Builder().requireWifi().build())) }
        catch (error: CancellationException) { throw error }
        catch (error: Exception) { throw CodedException("MODEL_DOWNLOAD_FAILED", "Language pack could not be prepared over Wi-Fi", null) }
        texts.map { awaitTask(translator.translate(it)) }
      } finally {
        translator.close()
      }
    }
  }

  private suspend fun <T> awaitTask(task: Task<T>): T = suspendCancellableCoroutine { continuation ->
    task.addOnSuccessListener { if (continuation.isActive) continuation.resume(it) }
    task.addOnFailureListener { if (continuation.isActive) continuation.resumeWithException(it) }
    task.addOnCanceledListener { continuation.cancel() }
  }
}
