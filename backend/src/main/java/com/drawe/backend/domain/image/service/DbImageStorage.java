package com.drawe.backend.domain.image.service;

import com.drawe.backend.domain.ImageBlob;
import com.drawe.backend.domain.User;
import com.drawe.backend.domain.image.repository.ImageBlobRepository;
import com.drawe.backend.global.error.CustomException;
import com.drawe.backend.global.error.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DbImageStorage implements ImageStorage {

  private final ImageBlobRepository imageBlobRepository;

  @Override
  @Transactional
  public Stored store(User owner, byte[] data, String mimeType) {
    ImageBlob blob = new ImageBlob();
    blob.setUser(owner);
    blob.setData(data);
    blob.setMimeType(mimeType);
    blob.setSizeBytes(data.length);
    ImageBlob saved = imageBlobRepository.save(blob);
    return new Stored(saved.getId(), "/images/" + saved.getId());
  }

  @Override
  @Transactional(readOnly = true)
  public Loaded load(Long id) {
    ImageBlob blob =
        imageBlobRepository
            .findById(id)
            .orElseThrow(() -> new CustomException(ErrorCode.NOT_FOUND));
    return new Loaded(blob.getId(), blob.getData(), blob.getMimeType(), blob.getUser().getId());
  }
}
